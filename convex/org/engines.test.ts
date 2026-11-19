import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { newBackend } from "../lib/convexTest.testing";
import { insertProjection } from "../lib/orgBilling.testing";
import { seedMissingTierPlans } from "../seeds/plans";

type Backend = ReturnType<typeof newBackend>;

interface Seed {
  tier?: "starter" | "pro";
  projection?: boolean;
  managed: number;
  selfHosted?: number;
  deleted?: number;
  overrideLimit?: number;
}

/** An org with the given engines already registered; the owner is the one who asks for another. */
async function seedOrg(t: Backend, seed: Seed) {
  return t.run(async (ctx) => {
    await seedMissingTierPlans(ctx, "test");
    const ownerId = await ctx.db.insert("users", { name: "Wolfy" });
    const accountId = await ctx.db.insert("accounts", { name: "Wolfy Streams", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    const engine = (hosting: "managed" | "external", n: number) =>
      ctx.db.insert("instances", {
        accountId,
        name: `${hosting} ${n}`,
        url: `https://${hosting}-${n}.test`,
        hosting,
        clientId: `client-${hosting}-${n}`,
        createdAt: 1,
      });
    for (let n = 0; n < seed.managed; n += 1) {
      await engine("managed", n);
    }
    for (let n = 0; n < (seed.selfHosted ?? 0); n += 1) {
      await engine("external", n);
    }
    for (let n = 0; n < (seed.deleted ?? 0); n += 1) {
      const instanceId = await engine("managed", 100 + n);
      await ctx.db.insert("engineProvisioning", {
        instanceId,
        accountId,
        requestedBy: ownerId,
        slug: `gone-${n}`,
        status: "deleted",
        steps: [],
        registrationToken: "token",
        registrationAttempts: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    }
    if (seed.projection !== false) {
      await insertProjection(ctx, accountId, {
        tier: seed.tier ?? "starter",
        overrides: {
          addFeatures: [],
          removeFeatures: [],
          limits: seed.overrideLimit === undefined ? [] : [{ key: "org.managedEngines", value: seed.overrideLimit }],
        },
      });
    }
    return { userId: ownerId, accountId };
  });
}

function prepare(t: Backend, org: { userId: Id<"users">; accountId: Id<"accounts"> }) {
  return t.mutation(internal.provisioningInternal.prepareNewEngine, { ...org, name: "Another" });
}

function reserve(t: Backend, org: { userId: Id<"users">; accountId: Id<"accounts"> }) {
  return t.mutation(internal.provisioningInternal.reserveManagedInstance, {
    accountId: org.accountId,
    userId: org.userId,
    slug: "another",
    newRegistrationToken: "token",
    newCreateRequestId: "request",
  });
}

const refused = (limit: number, current: number) => ({ data: { code: "managed_engine_limit", limit, current } });

describe("the managed engine limit", () => {
  test.each([
    ["Starter", "starter", 1],
    ["Pro", "pro", 3],
  ] as const)("%s refuses an engine past its limit", async (_name, tier, limit) => {
    const t = newBackend();
    const org = await seedOrg(t, { tier, managed: limit });
    await expect(prepare(t, org)).rejects.toMatchObject(refused(limit, limit));
    await expect(reserve(t, org)).rejects.toMatchObject(refused(limit, limit));
  });

  test.each([
    ["Starter", "starter", 0],
    ["Pro", "pro", 2],
  ] as const)("%s allows an engine under its limit", async (_name, tier, managed) => {
    const t = newBackend();
    const org = await seedOrg(t, { tier, managed });
    expect((await prepare(t, org)).building).toBe(false);
  });

  test("an org with no projection may make its first engine and not a second", async () => {
    const t = newBackend();
    const first = await seedOrg(t, { projection: false, managed: 0 });
    expect((await reserve(t, first)).instanceId).toBeDefined();
    const second = await seedOrg(t, { projection: false, managed: 1 });
    await expect(prepare(t, second)).rejects.toMatchObject(refused(1, 1));
  });

  test("an operator override raises the limit", async () => {
    const t = newBackend();
    const org = await seedOrg(t, { managed: 1, overrideLimit: 2 });
    expect((await prepare(t, org)).building).toBe(false);
  });

  test("self-hosted and deleted engines are not counted", async () => {
    const t = newBackend();
    const org = await seedOrg(t, { managed: 0, selfHosted: 2, deleted: 2 });
    expect((await prepare(t, org)).building).toBe(false);
  });

  test("an org already over its limit is refused another but keeps what it has", async () => {
    const t = newBackend();
    const org = await seedOrg(t, { managed: 3 });
    await expect(prepare(t, org)).rejects.toMatchObject(refused(1, 3));
    const kept = await t.run((ctx) => ctx.db.query("instances").collect());
    expect(kept.length).toBe(3);
  });
});
