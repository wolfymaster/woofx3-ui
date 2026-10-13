import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  ENTITLEMENT_FEATURES,
  type EntitlementFeatureKey,
  type Entitlements,
  resolveEntitlements,
} from "./entitlements";

/** The account's entitlements now. An account has at most one license row. */
export async function accountEntitlements(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Entitlements> {
  const license = await ctx.db
    .query("licenses")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  return resolveEntitlements(license, Date.now());
}

/**
 * Throws unless the account's plan includes the feature. A Convex function
 * that serves a paid feature calls this, so a hidden button is not the only
 * thing between a free account and the feature.
 */
export async function requireEntitlement(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  feature: EntitlementFeatureKey
): Promise<void> {
  const entitlements = await accountEntitlements(ctx, accountId);
  if (!entitlements.features.includes(feature)) {
    const { description } = ENTITLEMENT_FEATURES[feature] as { description: string };
    throw new ConvexError<string>(`Not included in your plan: ${description}`);
  }
}
