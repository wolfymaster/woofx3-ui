import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getMyAccount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user?.accountId) return null;
    return ctx.db.get(user.accountId as any);
  },
});

export const createAccount = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Prevent creating multiple accounts
    const user = await ctx.db.get(userId);
    if (user?.accountId) throw new Error("Account already exists");

    const accountId = await ctx.db.insert("accounts", {
      name: args.name,
      ownerId: userId,
      createdAt: Date.now(),
    });

    // Link account to user
    await ctx.db.patch(userId, { accountId } as any);

    // Create a free license for the account
    await ctx.db.insert("licenses", {
      accountId,
      tier: "free",
      features: [],
      createdAt: Date.now(),
    });

    return accountId;
  },
});
