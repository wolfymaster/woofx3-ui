import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx } from "./_generated/server";
import { isEmailVerified } from "./org/identity";

/** Longest a code may be, so a hostile client cannot make the lookup read a huge string. */
const MAX_SUPPLIED_CODE_LENGTH = 64;
/**
 * How long after sign-up a code is still accepted. A code is carried from the
 * sign-up link through an OAuth round trip, so it arrives within minutes; the
 * window keeps an established user from claiming a referrer afterwards.
 */
export const CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Records who referred the signed-in user, from the code their sign-up link
 * carried. Always answers null: an unknown or revoked code, a self-referral, a user who
 * is not new and a repeat capture are ignored alike, so the call reveals
 * nothing about which codes exist.
 */
export const capture = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    if (code.length === 0 || code.length > MAX_SUPPLIED_CODE_LENGTH) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (user === null || Date.now() - user._creationTime > CAPTURE_WINDOW_MS) {
      return null;
    }
    const already = await ctx.db
      .query("referrals")
      .withIndex("by_referred_user", (q) => q.eq("referredUserId", userId))
      .first();
    if (already !== null) {
      return null;
    }
    const owner = await ctx.db
      .query("referralCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (owner === null || owner.revokedAt !== undefined || owner.userId === userId) {
      return null;
    }
    const account = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    await ctx.db.insert("referrals", {
      referredUserId: userId,
      referredAccountId: account?._id,
      referrerUserId: owner.userId,
      code,
      rewardCents: owner.rewardCents,
      capturedAt: Date.now(),
      status: account ? "org_created" : "captured",
    });
    return null;
  },
});

/**
 * The one status transition: a captured referral learns its referred user's
 * org once it exists. Called wherever an owner's first org is made; a user
 * with no referral, or one already attached, is left alone.
 */
export async function attachReferredAccount(
  ctx: MutationCtx,
  userId: Id<"users">,
  accountId: Id<"accounts">
): Promise<void> {
  const referral = await ctx.db
    .query("referrals")
    .withIndex("by_referred_user", (q) => q.eq("referredUserId", userId))
    .first();
  if (referral === null || referral.status !== "captured") {
    return;
  }
  await ctx.db.patch(referral._id, { referredAccountId: accountId, status: "org_created" });
}

export async function referralForAccount(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"referrals"> | null> {
  return ctx.db
    .query("referrals")
    .withIndex("by_referred_account", (q) => q.eq("referredAccountId", accountId))
    .first();
}

/**
 * Whether the referral may earn its referrer a reward: the referred org exists,
 * the referrer has an org of their own that is a different one, and both people
 * have verified their email. An unverified address proves nothing, so a farm of
 * throwaway sign-ups cannot cash in.
 */
export async function rewardEligibility(
  ctx: QueryCtx,
  referral: Doc<"referrals">,
  referrerAccountId: Id<"accounts"> | null
): Promise<boolean> {
  if (referral.referredAccountId === undefined || referrerAccountId === null) {
    return false;
  }
  if (referrerAccountId === referral.referredAccountId || referral.referrerUserId === referral.referredUserId) {
    return false;
  }
  const [referrer, referred] = await Promise.all([
    ctx.db.get(referral.referrerUserId),
    ctx.db.get(referral.referredUserId),
  ]);
  return referrer !== null && referred !== null && isEmailVerified(referrer) && isEmailVerified(referred);
}
