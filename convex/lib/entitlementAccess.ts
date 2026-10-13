import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  ENTITLEMENT_FEATURES,
  type EntitlementFeatureKey,
  type Entitlements,
  isAssignmentActive,
  resolveEntitlements,
} from "./entitlements";

/** The plan for accounts without an active assignment, or null when operators have marked none. */
export async function defaultPlan(ctx: QueryCtx): Promise<Doc<"plans"> | null> {
  return ctx.db
    .query("plans")
    .withIndex("by_default", (q) => q.eq("isDefault", true))
    .unique();
}

/** The account's entitlements now. */
export async function accountEntitlements(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Entitlements> {
  const assignment = await ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  const now = Date.now();
  let plan: Doc<"plans"> | null;
  if (isAssignmentActive(assignment, now) && assignment.planId !== undefined) {
    plan = await ctx.db.get(assignment.planId);
    if (plan === null) {
      // deletePlan refuses a plan any account is on.
      throw new Error(`Account ${accountId} is on plan ${assignment.planId}, which does not exist`);
    }
  } else {
    plan = await defaultPlan(ctx);
  }
  return resolveEntitlements(plan, assignment, now);
}

/**
 * Throws unless the account's plan includes the feature. A Convex function
 * that serves a paid feature calls this, so a hidden button is not the only
 * thing between an account and the feature.
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
