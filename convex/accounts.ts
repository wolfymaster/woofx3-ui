import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

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

/** Owned account plus accounts shared via accountMembers (deduped). */
export const listAccessibleForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const owned = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const memberRows = await ctx.db
      .query("accountMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const byId = new Map<Id<"accounts">, { account: Doc<"accounts">; isOwner: boolean }>();

    for (const account of owned) {
      byId.set(account._id, { account, isOwner: true });
    }

    for (const row of memberRows) {
      const account = await ctx.db.get(row.accountId);
      if (!account) continue;
      const existing = byId.get(account._id);
      if (existing) {
        if (account.ownerId === userId) {
          existing.isOwner = true;
        }
        continue;
      }
      byId.set(account._id, { account, isOwner: account.ownerId === userId });
    }

    return Array.from(byId.values()).map(({ account, isOwner }) => ({
      _id: account._id,
      name: account.name,
      createdAt: account.createdAt,
      isOwner,
    }));
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

    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      name: args.name,
      ownerId: userId,
      createdAt: now,
    });

    await ctx.db.insert("accountMembers", {
      accountId,
      userId,
      role: "owner",
      createdAt: now,
    });

    await ctx.db.insert("licenses", {
      accountId,
      tier: "free",
      features: [],
      createdAt: now,
    });

    return accountId;
  },
});
