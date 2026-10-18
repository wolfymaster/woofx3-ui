import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { accountEntitlements } from "./entitlementAccess";
import { type FeatureFlagKey, type FeatureFlagSubject, isFlagOn } from "./featureFlags";
import { getInstanceMembership } from "./teamAccess";

/**
 * The subject a signed-in user is evaluated as. The instance contributes its
 * account, hosting and entitlements only when the user is a member of it: an
 * instance id is not a secret, and a non-member must not be able to borrow
 * another account's rollout.
 */
export async function featureFlagSubject(
  ctx: QueryCtx,
  userId: Id<"users">,
  instanceId: Id<"instances"> | undefined
): Promise<FeatureFlagSubject> {
  if (instanceId === undefined || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
    return { userId, entitlements: [] };
  }
  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    return { userId, entitlements: [] };
  }
  return {
    userId,
    accountId: instance.accountId,
    instanceId,
    hosting: instance.hosting ?? "external",
    entitlements: (await accountEntitlements(ctx, instance.accountId)).features,
  };
}

/**
 * The subject an instance is evaluated as when no user is involved, such as
 * an install that runs on the instance's behalf. Percent rollouts bucket by
 * the instance's account, as they do for a signed-in user.
 */
export async function instanceFeatureFlagSubject(
  ctx: QueryCtx,
  instanceId: Id<"instances">
): Promise<FeatureFlagSubject | null> {
  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    return null;
  }
  return {
    accountId: instance.accountId,
    instanceId,
    hosting: instance.hosting ?? "external",
    entitlements: (await accountEntitlements(ctx, instance.accountId)).features,
  };
}

export async function isFeatureFlagOn(
  ctx: QueryCtx,
  key: FeatureFlagKey,
  subject: FeatureFlagSubject
): Promise<boolean> {
  const row = await ctx.db
    .query("featureFlags")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return isFlagOn(row, subject);
}

/**
 * Throws unless the flag is on for the subject. Mutations and actions behind a
 * flag call this, so a hidden button is not the only thing keeping a feature
 * from users outside its rollout.
 */
export async function requireFeatureFlag(
  ctx: QueryCtx,
  key: FeatureFlagKey,
  subject: FeatureFlagSubject
): Promise<void> {
  if (!(await isFeatureFlagOn(ctx, key, subject))) {
    throw new ConvexError<string>(`This feature isn't available yet (${key})`);
  }
}
