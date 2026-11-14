import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { insertProjection } from "./lib/orgBilling.testing";

type Backend = ReturnType<typeof newBackend>;

interface Org {
  ownerId: Id<"users">;
  adminId: Id<"users">;
  accountId: Id<"accounts">;
  firstId: Id<"instances">;
}

/** A trialing org whose owner and admin are on its registered hosted engine, the owner's default. */
async function seedOrg(t: Backend): Promise<Org> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Wolfy" });
    const adminId = await ctx.db.insert("users", { name: "Kit" });
    const accountId = await ctx.db.insert("accounts", { name: "Wolfy Streams", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    const firstId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://wolfy.woofx3.test",
      hosting: "managed",
      clientId: "client-1",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId: firstId, userId: ownerId, role: "owner" });
    await ctx.db.insert("instanceMembers", { instanceId: firstId, userId: adminId, role: "admin" });
    await ctx.db.insert("userSettings", { userId: ownerId, defaultInstanceId: firstId, updatedAt: 1 });
    await insertProjection(ctx, accountId, { standing: "trialing", trialEndsAt: Date.now() + 1_000_000 });
    return { ownerId, adminId, accountId, firstId };
  });
}

function as(t: Backend, userId: Id<"users">) {
  return t.withIdentity({ subject: `${userId}|session` });
}

async function instancesOf(t: Backend, accountId: Id<"accounts">) {
  return t.run((ctx) =>
    ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()
  );
}

describe("creating another managed engine", () => {
  const realFetch = globalThis.fetch;
  const saved = {
    url: process.env.MAINTENANCE_API_URL,
    key: process.env.MAINTENANCE_API_KEY,
    site: process.env.CONVEX_SITE_URL,
  };
  let created: Array<{ slug: string; twitchChannel?: string; key: string | null }> = [];
  let refusal: string | null = null;

  beforeEach(() => {
    process.env.MAINTENANCE_API_URL = "https://maintenance.test";
    process.env.MAINTENANCE_API_KEY = "key";
    process.env.CONVEX_SITE_URL = "https://convex.test";
    created = [];
    refusal = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path !== "/v1/engines") {
        throw new Error(`unexpected maintenance call ${path}`);
      }
      const body = JSON.parse(String(init?.body));
      created.push({
        slug: body.slug,
        twitchChannel: body.twitchChannel,
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (refusal) {
        return Response.json({ error: { code: refusal, message: "no" } }, { status: 409 });
      }
      return Response.json({
        engine: { id: `eng_${body.slug}`, slug: body.slug, publicUrl: null },
        run: { id: "run_1", status: "running", currentStep: "provision", error: null, steps: [] },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.MAINTENANCE_API_URL = saved.url;
    process.env.MAINTENANCE_API_KEY = saved.key;
    process.env.CONVEX_SITE_URL = saved.site;
  });

  test("the owner gets a second engine, named and addressed as chosen, with the org's admins on it", async () => {
    const t = newBackend();
    const org = await seedOrg(t);

    const { instanceId } = await as(t, org.ownerId).action(api.provisioning.startNewEngine, {
      accountId: org.accountId,
      name: " Second channel ",
      slug: "second",
    });

    expect(instanceId).not.toBe(org.firstId);
    expect(created).toEqual([{ slug: "second", twitchChannel: undefined, key: expect.any(String) }]);
    const instance = await t.run((ctx) => ctx.db.get(instanceId));
    expect(instance).toMatchObject({ name: "Second channel", hosting: "managed", accountId: org.accountId });
    const roles = await t.run((ctx) =>
      ctx.db
        .query("instanceMembers")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .collect()
    );
    expect(roles.map((row) => [row.userId, row.role]).sort()).toEqual(
      [
        [org.ownerId, "owner"],
        [org.adminId, "admin"],
      ].sort()
    );
    expect((await as(t, org.ownerId).query(api.provisioning.forInstance, { instanceId }))?.status).toBe("provisioning");
  });

  test("asking again while it builds returns the same engine and asks the plane nothing more", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const owner = as(t, org.ownerId);
    const args = { accountId: org.accountId, name: "Second", slug: "second" };

    const first = await owner.action(api.provisioning.startNewEngine, args);
    const again = await owner.action(api.provisioning.startNewEngine, args);

    expect(again).toEqual(first);
    expect(created.length).toBe(1);
    expect((await instancesOf(t, org.accountId)).length).toBe(2);
  });

  test("the dashboard still opens on the owner's default engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const owner = as(t, org.ownerId);
    const { instanceId } = await owner.action(api.provisioning.startNewEngine, {
      accountId: org.accountId,
      name: "Second",
      slug: "second",
    });

    expect(await owner.query(api.access.entry, { selectedInstanceId: null })).toEqual({
      kind: "engine",
      instanceId: org.firstId,
      starting: false,
    });
    expect(await owner.query(api.access.entry, { selectedInstanceId: instanceId })).toEqual({
      kind: "engine",
      instanceId,
      starting: true,
    });
    const listed = await owner.query(api.instances.listForCurrentUser, {});
    expect(listed.map((row) => row._id).sort()).toEqual([org.firstId, instanceId].sort());
  });

  test("an admin is refused and nothing is made", async () => {
    const t = newBackend();
    const org = await seedOrg(t);

    await expect(
      as(t, org.adminId).action(api.provisioning.startNewEngine, {
        accountId: org.accountId,
        name: "Second",
        slug: "second",
      })
    ).rejects.toThrow("not_authorized");
    expect(created).toEqual([]);
    expect((await instancesOf(t, org.accountId)).length).toBe(1);
  });

  test("a suspended organization is refused and nothing is made", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("orgBilling").collect()) {
        await ctx.db.delete(row._id);
      }
      await insertProjection(ctx, org.accountId, { standing: "suspended", reason: "no_payment_method", version: 2 });
    });

    await expect(
      as(t, org.ownerId).action(api.provisioning.startNewEngine, {
        accountId: org.accountId,
        name: "Second",
        slug: "second",
      })
    ).rejects.toThrow("subscription_suspended");
    expect(created).toEqual([]);
    expect((await instancesOf(t, org.accountId)).length).toBe(1);
  });

  test("a blank name is refused before anything is made", async () => {
    const t = newBackend();
    const org = await seedOrg(t);

    await expect(
      as(t, org.ownerId).action(api.provisioning.startNewEngine, {
        accountId: org.accountId,
        name: "  ",
        slug: "second",
      })
    ).rejects.toThrow("invalid_name");
    expect((await instancesOf(t, org.accountId)).length).toBe(1);
  });

  test("a taken address is refused, and another one builds on the same engine", async () => {
    const t = newBackend();
    const org = await seedOrg(t);
    const owner = as(t, org.ownerId);
    refusal = "slug_taken";

    await expect(
      owner.action(api.provisioning.startNewEngine, { accountId: org.accountId, name: "Second", slug: "taken" })
    ).rejects.toThrow("slug_refused");
    refusal = null;
    const { instanceId } = await owner.action(api.provisioning.startNewEngine, {
      accountId: org.accountId,
      name: "Second",
      slug: "free",
    });

    expect(created.map((call) => call.slug)).toEqual(["taken", "free"]);
    const instances = await instancesOf(t, org.accountId);
    expect(instances.map((row) => row._id).sort()).toEqual([org.firstId, instanceId].sort());
  });
});
