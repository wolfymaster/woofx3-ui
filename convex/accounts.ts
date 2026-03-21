import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
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

    const accountId = await ctx.db.insert("accounts", {
      name: args.name,
      ownerId: userId,
      createdAt: Date.now(),
    });

    await ctx.db.insert("licenses", {
      accountId,
      tier: "free",
      features: [],
      createdAt: Date.now(),
    });

    return accountId;
  },
});
