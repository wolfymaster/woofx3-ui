import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { type FeatureFlagKey, type FeatureFlagSubject, isFlagOn } from "./featureFlags";
import { getInstanceMembership } from "./teamAccess";

/**
 * The subject a signed-in user is evaluated as. The instance contributes its
 * account, hosting and license only when the user is a member of it: an
 * instance id is not a secret, and a non-member must not be able to borrow
 * another account's rollout.
 */
export async function featureFlagSubject(
  ctx: QueryCtx,
  userId: Id<"users">,
  instanceId: Id<"instances"> | undefined
): Promise<FeatureFlagSubject> {
  if (instanceId === undefined || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
    return { userId, licenseFeatures: [] };
  }
  const instance = await ctx.db.get(instanceId);
  if (!instance) {
    return { userId, licenseFeatures: [] };
  }
  return {
    userId,
    accountId: instance.accountId,
    instanceId,
    hosting: instance.hosting ?? "external",
    licenseFeatures: await licenseFeatures(ctx, instance.accountId),
  };
}

/** Features listed by the account's unexpired licenses. */
export async function licenseFeatures(ctx: QueryCtx, accountId: Id<"accounts">): Promise<string[]> {
  const now = Date.now();
  const licenses = await ctx.db
    .query("licenses")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(16);
  const features = new Set<string>();
  for (const license of licenses) {
    if (license.expiresAt !== undefined && license.expiresAt <= now) {
      continue;
    }
    for (const feature of license.features) {
      features.add(feature);
    }
  }
  return [...features];
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
