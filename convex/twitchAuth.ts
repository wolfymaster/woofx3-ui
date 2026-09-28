import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { safeRelativePath } from "./lib/safeRedirect";

const TEN_MINUTES = 10 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

export const storeState = internalMutation({
  args: {
    state: v.string(),
    redirectTo: v.string(),
    instanceId: v.optional(v.id("instances")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, { state, redirectTo, instanceId, userId }) => {
    if ((instanceId === undefined) !== (userId === undefined)) {
      throw new Error("An integration connect needs both the instance and the user who started it");
    }
    await ctx.db.insert("twitchOAuthState", {
      state,
      // The callback page navigates here after Twitch answers.
      redirectTo: safeRelativePath(redirectTo),
      instanceId,
      userId,
      createdAt: Date.now(),
    });
  },
});

export const validateAndConsumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const record = await ctx.db
      .query("twitchOAuthState")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();

    if (!record) {
      return null;
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > TEN_MINUTES) {
      return null;
    }

    return {
      redirectTo: record.redirectTo,
      instanceId: record.instanceId ?? null,
      userId: record.userId ?? null,
    };
  },
});

export const storePendingAuth = internalMutation({
  args: {
    twitchId: v.string(),
    displayName: v.string(),
    email: v.string(),
    profileImage: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const token = crypto.randomUUID();
    await ctx.db.insert("twitchPendingAuth", {
      token,
      createdAt: Date.now(),
      ...args,
    });
    return token;
  },
});

export const lookupPendingAuth = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const record = await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!record) {
      return null;
    }
    if (Date.now() - record.createdAt > FIVE_MINUTES) {
      await ctx.db.delete(record._id);
      return null;
    }

    return {
      twitchId: record.twitchId,
      displayName: record.displayName,
      email: record.email,
      profileImage: record.profileImage,
    };
  },
});

export const deleteOrphanedAuthAccount = internalMutation({
  args: { providerAccountId: v.string() },
  handler: async (ctx, { providerAccountId }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "twitch").eq("providerAccountId", providerAccountId))
      .unique();

    if (!account) {
      return;
    }

    const user = await ctx.db.get(account.userId);

    if (user !== null) {
      return;
    }

    console.log("deleting orphaned authAccount for", providerAccountId);
    await ctx.db.delete(account._id);
  },
});

export const deletePendingAuth = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const record = await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (record) {
      await ctx.db.delete(record._id);
    }
  },
});
