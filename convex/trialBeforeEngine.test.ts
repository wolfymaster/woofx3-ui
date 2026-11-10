import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { orgBillingFor } from "./lib/orgBilling";
import { insertProjection } from "./lib/orgBilling.testing";

type Backend = ReturnType<typeof newBackend>;

const DAY = 24 * 60 * 60 * 1000;

async function seedOrg(t: Backend) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Wolfy" });
    const adminId = await ctx.db.insert("users", { name: "Kit" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    return { ownerId, adminId, accountId };
  });
}

async function addEngine(
  t: Backend,
  accountId: Id<"accounts">,
  members: Id<"users">[],
  hosting: "managed" | "external"
): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const instanceId = await ctx.db.insert("instances", { accountId, name: "Engine", url: "", hosting, createdAt: 1 });
    for (const userId of members) {
      await ctx.db.insert("instanceMembers", { instanceId, userId, role: "admin" });
    }
    return instanceId;
  });
}

/** The plane's projection of a trial that ended with no payment method: suspended. */
async function suspend(t: Backend, accountId: Id<"accounts">) {
  await t.run((ctx) =>
    insertProjection(ctx, accountId, { standing: "suspended", reason: "no_payment_method", version: 2 })
  );
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

describe("the trial starts before the engine is built", () => {
  const saved = { url: process.env.MAINTENANCE_API_URL, key: process.env.MAINTENANCE_API_KEY };

  beforeEach(() => {
    process.env.MAINTENANCE_API_URL = "https://maintenance.test";
    process.env.MAINTENANCE_API_KEY = "key";
  });

  afterEach(() => {
    process.env.MAINTENANCE_API_URL = saved.url;
    process.env.MAINTENANCE_API_KEY = saved.key;
  });

  test("choosing a hosted engine asks the plane for the trial and creates none locally", async () => {
    const realFetch = globalThis.fetch;
    const asked: Array<{ path: string; key: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ path: new URL(String(input)).pathname, key: new Headers(init?.headers).get("idempotency-key") });
      return new Response(JSON.stringify({ accountId: "x", version: 1 }), { status: 201 });
    }) as typeof fetch;
    try {
      const t = newBackend();
      const userId = await t.run((ctx) => ctx.db.insert("users", { name: "New" }));
      await as(t, userId).mutation(api.setup.ensureFirstRun, {});
      const account = await t.run((ctx) =>
        ctx.db
          .query("accounts")
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .unique()
      );
      if (account === null) {
        throw new Error("ensureFirstRun made no account");
      }
      await Bun.sleep(100);
      expect(await t.run((ctx) => orgBillingFor(ctx, account._id))).toBeNull();
      expect(asked.length).toBeGreaterThan(0);
      for (const call of asked) {
        expect(call).toEqual({ path: `/v1/billing/accounts/${account._id}/ensure`, key: `ensure:${account._id}` });
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("connecting a self-hosted engine starts no billing projection", async () => {
    const t = newBackend();
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Self" }));
    const user = as(t, userId);
    const accountId = await user.mutation(api.accounts.ensureMyAccount, {});
    const instanceId = await user.mutation(api.instances.create, { accountId, name: "Box", url: "localhost:8080" });
    expect(await t.run((ctx) => orgBillingFor(ctx, accountId))).toBeNull();
    expect(await user.query(api.access.planPrompt, { instanceId })).toBeNull();
  });
});

describe("provisioning while suspended", () => {
  test("is refused, even after the org deleted its stopped engine", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [ownerId], "managed");
    await t.run((ctx) =>
      ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy: ownerId,
        slug: "org",
        status: "deleted",
        steps: [],
        registrationToken: "token-0",
        registrationAttempts: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await suspend(t, accountId);
    await expect(
      t.mutation(internal.provisioningInternal.reserveManagedInstance, {
        accountId,
        userId: ownerId,
        slug: "org",
        newRegistrationToken: "token-1",
        newCreateRequestId: "request-1",
      })
    ).rejects.toThrow("subscription_suspended");
    const rows = await t.run((ctx) => ctx.db.query("engineProvisioning").collect());
    expect(rows.map((row) => row.status)).toEqual(["deleted"]);
  });
});

describe("resuming a managed engine while suspended", () => {
  const realFetch = globalThis.fetch;
  let calls = 0;

  beforeEach(() => {
    calls = 0;
    // Typed as fetch's call signature; the cast adds only Bun's `preconnect`.
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      calls += 1;
      throw new Error("no network in tests");
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("a failed run is not resumed, and the maintenance API is never called", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [ownerId], "managed");
    await t.run((ctx) =>
      ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy: ownerId,
        slug: "org",
        status: "failed",
        steps: [],
        registrationToken: "token-0",
        registrationAttempts: 0,
        maintenanceEngineId: "eng_1",
        runId: "run_1",
        createdAt: 1,
        updatedAt: 1,
      })
    );
    await suspend(t, accountId);
    await expect(as(t, ownerId).action(api.provisioning.retry, { instanceId })).rejects.toThrow(
      "subscription_suspended"
    );
    expect(calls).toBe(0);
  });

  test("an org with no billing projection may still resume", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    expect(await t.query(internal.provisioningInternal.assertCanResumeEngine, { accountId })).toBeNull();
  });
});

describe("access.planPrompt", () => {
  test("asks the owner of a suspended org to choose a plan", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [ownerId], "managed");
    await suspend(t, accountId);
    expect(await as(t, ownerId).query(api.access.planPrompt, { instanceId })).toEqual({ kind: "choosePlan" });
  });

  test("an invitee never sees the trial or a plan prompt", async () => {
    const t = newBackend();
    const { ownerId, adminId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [ownerId, adminId], "managed");
    const admin = as(t, adminId);
    await t.run((ctx) =>
      insertProjection(ctx, accountId, { standing: "trialing", trialEndsAt: Date.now() + 30 * DAY })
    );
    expect(await admin.query(api.access.planPrompt, { instanceId })).toBeNull();
    await t.run(async (ctx) => {
      const row = await orgBillingFor(ctx, accountId);
      if (row !== null) {
        await ctx.db.delete(row._id);
      }
    });
    await suspend(t, accountId);
    expect(await admin.query(api.access.planPrompt, { instanceId })).toBeNull();
  });

  test("a self-hosted-only owner never sees it, whatever the org's state", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [ownerId], "external");
    await suspend(t, accountId);
    expect(await as(t, ownerId).query(api.access.planPrompt, { instanceId })).toBeNull();
  });

  test("a non-member gets nothing", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seedOrg(t);
    const instanceId = await addEngine(t, accountId, [], "managed");
    await suspend(t, accountId);
    expect(await as(t, ownerId).query(api.access.planPrompt, { instanceId })).toBeNull();
  });
});
