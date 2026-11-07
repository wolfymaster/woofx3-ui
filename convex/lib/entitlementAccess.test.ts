import { describe, expect, test } from "bun:test";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { PLAN_SEEDS } from "../seeds/plans";
import { newBackend } from "./convexTest.testing";
import { accountEntitlements, engineAvailability, hasFeature, requireFeature } from "./entitlementAccess";
import {
  addOnFeatures,
  ENTITLEMENT_FEATURES,
  type EntitlementFeatureKey,
  type SubscriptionSummary,
} from "./entitlements";
import type { SubscriptionState } from "./organization";
import { upsertPlan } from "./plans";

type Backend = ReturnType<typeof newBackend>;

const NOW = Date.UTC(2026, 10, 1);
const ALL_FEATURES = Object.keys(ENTITLEMENT_FEATURES) as EntitlementFeatureKey[];

async function seedOrg(t: Backend, plan: "starter" | "pro", state: SubscriptionState) {
  return t.run(async (ctx) => {
    for (const seed of PLAN_SEEDS) {
      await upsertPlan(ctx, { ...seed, features: seed.key === "pro" ? ALL_FEATURES : seed.features }, "test");
    }
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    const engine = (hosting: "managed" | "external") =>
      ctx.db.insert("instances", { accountId, name: hosting, url: "https://e", hosting, createdAt: 1 });
    const managedId = await engine("managed");
    const externalId = await engine("external");
    await ctx.db.insert("subscriptions", {
      accountId,
      plan,
      state,
      stateReason: state === "suspended" ? "operator" : undefined,
      stateSince: NOW,
      addOns: [],
      origin: "operator",
      updatedAt: NOW,
      updatedBy: "test",
    });
    return { accountId, managedId, externalId };
  });
}

describe("engineAvailability", () => {
  test("a self-hosted engine offers no feature, even for a Pro org", async () => {
    const t = newBackend();
    const { externalId } = await seedOrg(t, "pro", "active");
    const availability = await t.run((ctx) => engineAvailability(ctx, externalId, NOW));
    expect(availability).toEqual({ availability: "self_hosted" });
    for (const feature of ALL_FEATURES) {
      expect(hasFeature(availability, feature)).toBe(false);
      await expect(t.run((ctx) => requireFeature(ctx, externalId, feature))).rejects.toThrow(
        "Available on hosted engines"
      );
    }
  });

  test("a hosted engine of a Pro org has the plan's features", async () => {
    const t = newBackend();
    const { managedId } = await seedOrg(t, "pro", "active");
    const availability = await t.run((ctx) => engineAvailability(ctx, managedId, NOW));
    expect(hasFeature(availability, "business")).toBe(true);
    await t.run((ctx) => requireFeature(ctx, managedId, "business"));
  });

  test("a hosted Starter engine is refused a Pro feature as not entitled", async () => {
    const t = newBackend();
    const { managedId } = await seedOrg(t, "starter", "trialing");
    await expect(t.run((ctx) => requireFeature(ctx, managedId, "business"))).rejects.toThrow(
      "Not included in your plan"
    );
  });
});

describe("accountEntitlements", () => {
  test("a suspended org gets no plan features and the code-default limits", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t, "pro", "suspended");
    const entitlements = await t.run((ctx) => accountEntitlements(ctx, accountId, NOW));
    expect(entitlements.plan).toBeNull();
    expect(entitlements.features).toEqual([]);
    expect(entitlements.limits["org.members"]).toBe(5);
    expect(entitlements.subscription?.state).toBe("suspended");
  });

  test("past_due and exempt orgs keep their plan", async () => {
    for (const state of ["past_due", "exempt"] as const) {
      const t = newBackend();
      const { accountId } = await seedOrg(t, "pro", state);
      const entitlements = await t.run((ctx) => accountEntitlements(ctx, accountId, NOW));
      expect(entitlements.plan?.key).toBe("pro");
      expect(entitlements.limits["org.members"]).toBeNull();
    }
  });

  test("a tier with no plan row is an error, not an empty plan", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t, "pro", "active");
    await t.run(async (ctx) => {
      for (const plan of await ctx.db.query("plans").collect()) {
        await ctx.db.delete(plan._id);
      }
    });
    await expect(t.run((ctx) => accountEntitlements(ctx, accountId, NOW))).rejects.toThrow(
      'No plan row for tier "pro"'
    );
  });
});

describe("addOnFeatures", () => {
  const registry = {
    relay: { description: "Relay", features: ["business" as const] },
    wishlist: { description: "Wish list", features: ["userPages.customDomain" as const] },
  };
  const summary = (plan: "starter" | "pro", state: SubscriptionState): SubscriptionSummary => ({
    plan,
    interval: null,
    state,
    stateReason: null,
    nextBillingAt: null,
    graceEndsAt: null,
    exemptUntil: null,
  });

  test("Pro grants every add-on's features", () => {
    expect(addOnFeatures(summary("pro", "active"), [], registry).sort()).toEqual([
      "business",
      "userPages.customDomain",
    ]);
  });

  test("Starter grants only the add-ons it bought, ignoring unknown keys", () => {
    expect(addOnFeatures(summary("starter", "active"), ["wishlist", "gone"], registry)).toEqual([
      "userPages.customDomain",
    ]);
  });

  test("a suspended or missing subscription grants none", () => {
    expect(addOnFeatures(summary("pro", "suspended"), [], registry)).toEqual([]);
    expect(addOnFeatures(null, ["wishlist"], registry)).toEqual([]);
  });
});

describe("seat limit", () => {
  async function fullStarterOrg(t: Backend) {
    const { accountId, managedId } = await seedOrg(t, "starter", "active");
    const ownerId = await t.run(async (ctx) => {
      const account = await ctx.db.get(accountId);
      if (account === null) {
        throw new Error("fixture");
      }
      await ctx.db.insert("accountMembers", { accountId, userId: account.ownerId, role: "owner", createdAt: 1 });
      await ctx.db.insert("instanceMembers", { instanceId: managedId, userId: account.ownerId, role: "owner" });
      for (let i = 0; i < 4; i++) {
        const userId = await ctx.db.insert("users", { name: `m${i}` });
        await ctx.db.insert("accountMembers", { accountId, userId, role: "member", createdAt: 1 });
      }
      return account.ownerId;
    });
    return { accountId, managedId, ownerId };
  }

  test("a full Starter org refuses the invite and the accept", async () => {
    const t = newBackend();
    const { accountId, managedId, ownerId } = await fullStarterOrg(t);
    await expect(
      t.withIdentity({ subject: `${ownerId}|s` }).action(api.invitations.create, {
        instanceId: managedId,
        engineRole: "member",
        target: { kind: "email", email: "sixth@example.com" },
      })
    ).rejects.toThrow("seats are all taken");
    const inviteeId: Id<"users"> = await t.run(async (ctx) => {
      await ctx.db.insert("invitations", {
        accountId,
        instanceId: managedId,
        engineRole: "member",
        email: "sixth@example.com",
        role: "member",
        token: "full",
        invitedByUserId: ownerId,
        status: "pending",
        expiresAt: Date.now() + 60_000,
        createdAt: 1,
      });
      return ctx.db.insert("users", { name: "Sixth", email: "sixth@example.com" });
    });
    await expect(
      t.withIdentity({ subject: `${inviteeId}|s` }).mutation(api.invitations.accept, { token: "full" })
    ).rejects.toThrow("seats are all taken");
  });
});
