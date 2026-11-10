import { describe, expect, test } from "bun:test";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { startTrialIfNew } from "../provisioningInternal";
import { PLAN_SEEDS } from "../seeds/plans";
import { newBackend } from "./convexTest.testing";
import { requireUsableSubscription } from "./entitlementAccess";
import { upsertPlan } from "./plans";
import { subscriptionFor } from "./subscriptions";

// Each call site that reads billing through billingFor, driven by a projection.

type Backend = ReturnType<typeof newBackend>;

const NOW = Date.UTC(2026, 10, 1);
const TRIAL_END = NOW + 5 * 86_400_000;

async function seed(t: Backend) {
  return t.run(async (ctx) => {
    for (const planSeed of PLAN_SEEDS) {
      await upsertPlan(ctx, planSeed, "test");
    }
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Hosted",
      url: "https://h.example",
      hosting: "managed",
      createdAt: 1,
      clientId: "client-1",
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
    return { ownerId, accountId, instanceId };
  });
}

async function project(t: Backend, accountId: Id<"accounts">, projection: Partial<Doc<"orgBilling">> = {}) {
  await t.run((ctx) =>
    ctx.db.insert("orgBilling", {
      accountId,
      version: 1,
      tier: "starter",
      addOns: [],
      standing: "active",
      reason: null,
      trialEndsAt: null,
      graceEndsAt: null,
      periodEnd: null,
      interval: null,
      exemptUntil: null,
      spinDownAt: null,
      hasProviderSubscription: false,
      discount: null,
      overrides: { addFeatures: [], removeFeatures: [], limits: [] },
      updatedAt: NOW,
      ...projection,
    })
  );
}

const as = (t: Backend, userId: Id<"users">) => t.withIdentity({ subject: `${userId}|session` });

describe.each<[string, "starter" | "pro" | null]>([
  ["tier", "pro"],
  ["no tier", null],
])("a suspended projection with %s", (_name, tier) => {
  test("access.entry locks the hosted engine with the projection's reason", async () => {
    const t = newBackend();
    const { ownerId, instanceId } = await seed(t);
    const { accountId } = await t.run(async (ctx) => ({
      accountId: (await ctx.db.get(instanceId))?.accountId as Id<"accounts">,
    }));
    await project(t, accountId, { tier, standing: "suspended", reason: "operator" });
    expect(await as(t, ownerId).query(api.access.entry, { selectedInstanceId: instanceId })).toMatchObject({
      kind: "suspended",
      instanceId,
      reason: "operator",
      canManageBilling: true,
    });
  });

  test("access.planPrompt asks the owner to choose a plan", async () => {
    const t = newBackend();
    const { ownerId, accountId, instanceId } = await seed(t);
    await project(t, accountId, { tier, standing: "suspended", reason: "operator" });
    expect(await as(t, ownerId).query(api.access.planPrompt, { instanceId })).toEqual({ kind: "choosePlan" });
  });
});

describe("access.planPrompt on a trialing projection", () => {
  test.each<["starter" | null]>([["starter"], [null]])("shows the trial end (tier %p)", async (tier) => {
    const t = newBackend();
    const { ownerId, accountId, instanceId } = await seed(t);
    await project(t, accountId, { tier, standing: "trialing", trialEndsAt: TRIAL_END, periodEnd: 1 });
    expect(await as(t, ownerId).query(api.access.planPrompt, { instanceId })).toEqual({
      kind: "trial",
      endsAt: TRIAL_END,
    });
  });
});

describe("organizations.mine", () => {
  test("shows the projection's portal fields, the discount to the owner", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    await project(t, accountId, {
      standing: "suspended",
      reason: "payment_failed",
      interval: "year",
      exemptUntil: 777,
      spinDownAt: 888,
      hasProviderSubscription: true,
      discount: { label: "50% off for 3 months" },
    });
    const [organization] = await as(t, ownerId).query(api.organizations.mine, { now: NOW });
    expect(organization?.subscription).toMatchObject({
      plan: "starter",
      interval: "year",
      state: "suspended",
      exemptUntil: 777,
      spinDownAt: 888,
      hasProviderSubscription: true,
      discount: { label: "50% off for 3 months" },
    });
  });

  test("a no-tier projection still reports its standing", async () => {
    const t = newBackend();
    const { ownerId, accountId } = await seed(t);
    await project(t, accountId, { tier: null, standing: "trialing", trialEndsAt: TRIAL_END });
    const [organization] = await as(t, ownerId).query(api.organizations.mine, { now: NOW });
    expect(organization?.subscription).toMatchObject({ plan: null, state: "trialing", nextBillingAt: TRIAL_END });
  });
});

describe("startTrialIfNew", () => {
  test.each<["starter" | null]>([["starter"], [null]])(
    "starts no Convex trial when a projection exists (tier %p)",
    async (tier) => {
      const t = newBackend();
      const { accountId } = await seed(t);
      await project(t, accountId, { tier, standing: "trialing", trialEndsAt: TRIAL_END });
      await t.run((ctx) => startTrialIfNew(ctx, accountId, NOW));
      expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toBeNull();
      await t.run((ctx) => requireUsableSubscription(ctx, accountId));
    }
  );
});
