import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { accountEntitlements } from "./lib/entitlementAccess";
import { type Entitlements, isEntitlementFeatureKey } from "./lib/entitlements";
import { getInstanceMembership } from "./lib/teamAccess";

const tierValidator = v.union(v.literal("free"), v.literal("pro"), v.literal("enterprise"));

/**
 * The entitlements of the account that owns an instance, for a member of it.
 * Null for a non-member or a missing instance: an instance id is not a secret.
 */
export const forViewer = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Entitlements | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    return accountEntitlements(ctx, instance.accountId);
  },
});

/** An account's entitlements, for operators: `bunx convex run entitlements:get '{"accountId": "…"}'` */
export const get = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Entitlements> => {
    return accountEntitlements(ctx, accountId);
  },
});

/**
 * Sets an account's license: its tier, features beyond the tier's, and when
 * it lapses back to free. Operator-only until billing writes licenses:
 *
 *   bunx convex run entitlements:setLicense '{"accountId": "…", "tier": "pro", "features": []}'
 */
export const setLicense = internalMutation({
  args: {
    accountId: v.id("accounts"),
    tier: tierValidator,
    features: v.array(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, tier, features, expiresAt }) => {
    if (!(await ctx.db.get(accountId))) {
      throw new Error(`No account ${accountId}`);
    }
    for (const feature of features) {
      if (!isEntitlementFeatureKey(feature)) {
        throw new Error(`Unknown entitlement "${feature}"; add it to ENTITLEMENT_FEATURES first`);
      }
    }
    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { tier, features, expiresAt });
    } else {
      await ctx.db.insert("licenses", { accountId, tier, features, expiresAt, createdAt: Date.now() });
    }
  },
});
