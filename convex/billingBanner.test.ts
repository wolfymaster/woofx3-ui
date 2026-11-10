import { describe, expect, test } from "bun:test";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { billingBanner } from "./lib/billingBanner";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);

describe("billingBanner", () => {
  const ends = T0 + 30 * DAY;
  const cases: Array<[string, Parameters<typeof billingBanner>[0], number, ReturnType<typeof billingBanner>]> = [
    ["no billing", null, T0, null],
    ["early in a trial", { state: "trialing", nextBillingAt: ends, graceEndsAt: null }, T0, null],
    [
      "the last week of a trial",
      { state: "trialing", nextBillingAt: ends, graceEndsAt: null },
      ends - 7 * DAY,
      { kind: "trial_ending", dateIso: new Date(ends).toISOString() },
    ],
    [
      "past due",
      { state: "past_due", nextBillingAt: null, graceEndsAt: ends },
      T0,
      { kind: "payment_needed", dateIso: new Date(ends).toISOString() },
    ],
    ["exempt", { state: "exempt", nextBillingAt: null, graceEndsAt: null }, T0, null],
    ["active", { state: "active", nextBillingAt: ends, graceEndsAt: null }, ends - DAY, null],
  ];
  for (const [name, billing, now, expected] of cases) {
    test(name, () => {
      expect(billingBanner(billing, now)).toEqual(expected);
    });
  }
});

describe("billingBanner.forViewer", () => {
  async function pastDueOrg(t: Backend, hosting: "managed" | "external") {
    return t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const memberId = await ctx.db.insert("users", { name: "Member" });
      const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("accountMembers", { accountId, userId: memberId, role: "member", createdAt: 1 });
      const instanceId: Id<"instances"> = await ctx.db.insert("instances", {
        accountId,
        name: "Main",
        url: "https://e",
        hosting,
        createdAt: 1,
      });
      await ctx.db.insert("instanceMembers", { instanceId, userId: ownerId, role: "owner" });
      await ctx.db.insert("instanceMembers", { instanceId, userId: memberId, role: "member" });
      await ctx.db.insert("plans", {
        key: "starter",
        name: "Starter",
        features: [],
        limits: [],
        offered: true,
        isDefault: false,
        updatedAt: 1,
        updatedBy: "test",
      });
      await ctx.db.insert("orgBilling", {
        accountId,
        version: 1,
        tier: "starter",
        addOns: [],
        standing: "past_due",
        reason: "payment_failed",
        trialEndsAt: null,
        graceEndsAt: T0 + 14 * DAY,
        periodEnd: null,
        interval: null,
        exemptUntil: null,
        spinDownAt: null,
        hasProviderSubscription: true,
        discount: null,
        overrides: { addFeatures: [], removeFeatures: [], limits: [] },
        updatedAt: T0,
      });
      return { instanceId, ownerId, memberId };
    });
  }

  test("the owner can act on it; a member sees the date only", async () => {
    const t = newBackend();
    const { instanceId, ownerId, memberId } = await pastDueOrg(t, "managed");
    const asOwner = await t.withIdentity({ subject: `${ownerId}|s` }).query(api.billingBanner.forViewer, {
      instanceId,
      now: T0,
    });
    expect(asOwner).toMatchObject({ kind: "payment_needed", canManageBilling: true });
    const asMember = await t.withIdentity({ subject: `${memberId}|s` }).query(api.billingBanner.forViewer, {
      instanceId,
      now: T0,
    });
    expect(asMember).toMatchObject({ kind: "payment_needed", canManageBilling: false });
  });

  test("a self-hosted engine never shows one", async () => {
    const t = newBackend();
    const { instanceId, ownerId } = await pastDueOrg(t, "external");
    expect(
      await t.withIdentity({ subject: `${ownerId}|s` }).query(api.billingBanner.forViewer, { instanceId, now: T0 })
    ).toBeNull();
  });
});
