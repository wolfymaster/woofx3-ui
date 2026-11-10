import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { PLACEHOLDER_NAME } from "./lib/firstRun";

export const getMyAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
  },
});

export const createAccount = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    if (existing) throw new Error("Account already exists");

    return insertAccount(ctx, userId, args.name);
  },
});

async function insertAccount(ctx: MutationCtx, userId: Id<"users">, name: string): Promise<Id<"accounts">> {
  const now = Date.now();
  const accountId = await ctx.db.insert("accounts", { name, ownerId: userId, createdAt: now });
  await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: now });
  return accountId;
}

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
