import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, type QueryCtx } from "./_generated/server";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;
const MAX_CODE_ATTEMPTS = 5;
/** Longest a code may be, so a hostile client cannot make the lookup read a huge string. */
const MAX_SUPPLIED_CODE_LENGTH = 64;
/**
 * How long after sign-up a code is still accepted. A code is carried from the
 * sign-up link through an OAuth round trip, so it arrives within minutes; the
 * window keeps an established user from claiming a referrer afterwards.
 */
export const CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/** The user's sign-up code, made on first use. */
export async function codeFor(ctx: MutationCtx, userId: Id<"users">): Promise<string> {
  const existing = await ctx.db
    .query("referralCodes")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existing) {
    return existing.code;
  }
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = randomCode();
    const taken = await ctx.db
      .query("referralCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (taken === null) {
      await ctx.db.insert("referralCodes", { userId, code, createdAt: Date.now() });
      return code;
    }
  }
  throw new Error("Could not find an unused referral code");
}

export const myCode = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return codeFor(ctx, userId);
  },
});

/**
 * Records who referred the signed-in user, from the code their sign-up link
 * carried. Always answers null: an unknown code, a self-referral, a user who
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
    if (owner === null || owner.userId === userId) {
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
