import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation } from "./_generated/server";
import { PLACEHOLDER_NAME } from "./lib/firstRun";
import { insertAccount } from "./org/membership";
import { attachReferredAccount } from "./referrals";

/** The account the user owns, made under the placeholder name when they have none. */
export async function ensureOwnAccount(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"accounts">> {
  const existing = await ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .first();
  if (existing) {
    return existing;
  }
  const account = await ctx.db.get(await insertAccount(ctx, userId, PLACEHOLDER_NAME));
  if (!account) {
    throw new Error("The account just created cannot be read");
  }
  await attachReferredAccount(ctx, userId, account._id);
  return account;
}

/** Gives an engine-less user an account, for the form that connects their own engine. */
export const ensureMyAccount = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"accounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    return (await ensureOwnAccount(ctx, userId))._id;
  },
});
