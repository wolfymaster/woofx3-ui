import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { PLAN_SEEDS } from "../seeds/plans";
import { newBackend } from "./convexTest.testing";
import { accountEntitlements, orgSeatLimit, requireUsableSubscription } from "./entitlementAccess";
import { upsertPlan } from "./plans";

type Backend = ReturnType<typeof newBackend>;
type Standing = Doc<"orgBilling">["standing"];

const NOW = Date.UTC(2026, 10, 1);
const NO_OVERRIDES = { addFeatures: [], removeFeatures: [], limits: [] };

async function seedOrg(t: Backend): Promise<Id<"accounts">> {
  return t.run(async (ctx) => {
    for (const seed of PLAN_SEEDS) {
      await upsertPlan(ctx, seed, "test");
    }
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    return ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
  });
}

async function giveSubscription(t: Backend, accountId: Id<"accounts">, plan: "starter" | "pro", state: Standing) {
  await t.run((ctx) =>
    ctx.db.insert("subscriptions", {
      accountId,
      plan,
      state,
      stateReason: state === "suspended" ? "operator" : undefined,
      stateSince: NOW,
      addOns: [],
      origin: "operator",
      updatedAt: NOW,
      updatedBy: "test",
    })
  );
}

async function giveProjection(t: Backend, accountId: Id<"accounts">, projection: Partial<Doc<"orgBilling">> = {}) {
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
      overrides: NO_OVERRIDES,
      updatedAt: NOW,
      ...projection,
    })
  );
}

const entitlements = (t: Backend, accountId: Id<"accounts">) =>
  t.run((ctx) => accountEntitlements(ctx, accountId, NOW));
const refusal = (t: Backend, accountId: Id<"accounts">) =>
  t
    .run((ctx) => requireUsableSubscription(ctx, accountId))
    .then(
      () => null,
      (error: { data: { code: string } }) => error.data.code
    );

describe("standing drives the gates the same from a projection as from a subscription", () => {
  test.each<[Standing, boolean]>([
    ["trialing", true],
    ["active", true],
    ["past_due", true],
    ["exempt", true],
    ["suspended", false],
  ])("%s: usable is %p", async (standing, usable) => {
    const reason = standing === "suspended" || standing === "past_due" ? ("payment_failed" as const) : null;
    const fromRow = newBackend();
    const rowOrg = await seedOrg(fromRow);
    await giveSubscription(fromRow, rowOrg, "pro", standing);
    const fromProjection = newBackend();
    const projectionOrg = await seedOrg(fromProjection);
    await giveProjection(fromProjection, projectionOrg, { tier: "pro", standing, reason });

    for (const [t, accountId] of [
      [fromRow, rowOrg],
      [fromProjection, projectionOrg],
    ] as const) {
      expect(await refusal(t, accountId)).toBe(usable ? null : "subscription_suspended");
      const resolved = await entitlements(t, accountId);
      expect(resolved.plan?.key ?? null).toBe(usable ? "pro" : null);
      expect(resolved.features.includes("business")).toBe(usable);
      expect(resolved.subscription?.state).toBe(standing);
    }
  });
});

describe("a projection with no tier keeps its standing", () => {
  test.each<[Standing, boolean]>([
    ["trialing", true],
    ["active", true],
    ["past_due", true],
    ["exempt", true],
    ["suspended", false],
  ])("%s: usable is %p, and no plan or add-on feature is granted", async (standing, usable) => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    const reason = standing === "suspended" || standing === "past_due" ? ("payment_failed" as const) : null;
    await giveProjection(t, accountId, {
      tier: null,
      standing,
      reason,
      trialEndsAt: standing === "trialing" ? 111 : null,
      addOns: ["userPages"],
    });
    expect(await refusal(t, accountId)).toBe(usable ? null : "subscription_suspended");
    const resolved = await entitlements(t, accountId);
    expect(resolved.plan).toBeNull();
    expect(resolved.features).toEqual([]);
    expect(resolved.subscription).toMatchObject({ plan: null, state: standing, stateReason: reason });
  });

  test("a self-hosted-only org with a no-tier projection has no seat limit", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await t.run((ctx) =>
      ctx.db.insert("instances", {
        accountId,
        name: "Box",
        url: "https://b.example",
        hosting: "external",
        createdAt: 1,
      })
    );
    await giveProjection(t, accountId, { tier: null, standing: "trialing", trialEndsAt: 111 });
    expect(await t.run((ctx) => orgSeatLimit(ctx, accountId, NOW))).toBeNull();
  });

  test("a managed engine seats a no-tier org", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await t.run((ctx) =>
      ctx.db.insert("instances", { accountId, name: "Box", url: "https://b.example", hosting: "managed", createdAt: 1 })
    );
    await giveProjection(t, accountId, { tier: null, standing: "trialing", trialEndsAt: 111 });
    expect(await t.run((ctx) => orgSeatLimit(ctx, accountId, NOW))).not.toBeNull();
  });
});

describe("with and without a projection", () => {
  test("no row of either kind keeps the default-plan behaviour", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    expect((await entitlements(t, accountId)).subscription).toBeNull();
    expect(await t.run((ctx) => orgSeatLimit(ctx, accountId, NOW))).toBeNull();
  });

  test("a projection wins over a subscription row", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveSubscription(t, accountId, "pro", "active");
    await giveProjection(t, accountId, { tier: "starter", standing: "suspended", reason: "operator" });
    const resolved = await entitlements(t, accountId);
    expect(resolved.plan).toBeNull();
    expect(resolved.subscription).toMatchObject({ plan: "starter", state: "suspended" });
  });

  test("a projection alone seats the org, so its member limit applies", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveProjection(t, accountId, { tier: "starter" });
    expect(await t.run((ctx) => orgSeatLimit(ctx, accountId, NOW))).toBe(5);
  });

  test("trialing reports the trial end as the next billing date, active the period end", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveProjection(t, accountId, { standing: "trialing", trialEndsAt: 111, periodEnd: 222 });
    expect((await entitlements(t, accountId)).subscription?.nextBillingAt).toBe(111);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("orgBilling").unique();
      await ctx.db.patch(row?._id as Id<"orgBilling">, { standing: "active" });
    });
    expect((await entitlements(t, accountId)).subscription?.nextBillingAt).toBe(222);
  });
});

describe("overrides and add-ons layer over the tier's plan", () => {
  test("add and remove features, and set a limit", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveProjection(t, accountId, {
      tier: "pro",
      overrides: {
        addFeatures: ["userPages"],
        removeFeatures: ["business"],
        limits: [{ key: "org.members", value: 12 }],
      },
    });
    const resolved = await entitlements(t, accountId);
    expect(resolved.features).toContain("userPages");
    expect(resolved.features).not.toContain("business");
    expect(resolved.features).toContain("marketplace.premiumIncluded");
    expect(resolved.limits["org.members"]).toBe(12);
    expect(resolved.limits["analytics.retentionDays"]).toBe(90);
  });

  test("keys code does not know are dropped", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveProjection(t, accountId, {
      overrides: { addFeatures: ["notAFeature"], removeFeatures: [], limits: [{ key: "notALimit", value: 1 }] },
    });
    const resolved = await entitlements(t, accountId);
    expect(resolved.features).not.toContain("notAFeature");
    expect(resolved.limits).not.toHaveProperty("notALimit");
  });

  test("overrides still apply while suspended, as accountPlans overrides do on a subscription", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await giveProjection(t, accountId, {
      standing: "suspended",
      reason: "operator",
      overrides: { addFeatures: ["userPages"], removeFeatures: [], limits: [] },
    });
    expect((await entitlements(t, accountId)).features).toEqual(["userPages"]);
  });

  test("a projection ignores the account's accountPlans overrides", async () => {
    const t = newBackend();
    const accountId = await seedOrg(t);
    await t.run((ctx) =>
      ctx.db.insert("accountPlans", {
        accountId,
        addFeatures: ["userPages"],
        removeFeatures: [],
        limits: [],
        updatedAt: NOW,
        updatedBy: "test",
      })
    );
    await giveProjection(t, accountId);
    expect((await entitlements(t, accountId)).features).not.toContain("userPages");
  });
});

test("assertCanResumeEngine follows a projection's standing", async () => {
  const t = newBackend();
  const accountId = await seedOrg(t);
  expect(await t.query(internal.provisioningInternal.assertCanResumeEngine, { accountId })).toBeNull();
  await giveProjection(t, accountId, { standing: "suspended", reason: "operator" });
  await expect(t.query(internal.provisioningInternal.assertCanResumeEngine, { accountId })).rejects.toThrow();
});
