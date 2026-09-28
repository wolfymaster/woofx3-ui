import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { signInNonceMatches } from "./lib/oauthHandoff";
import { safeRelativePath } from "./lib/safeRedirect";

const TEN_MINUTES = 10 * 60 * 1000;
const FIVE_MINUTES = 5 * 60 * 1000;

export const storeState = internalMutation({
  args: {
    state: v.string(),
    redirectTo: v.string(),
    instanceId: v.optional(v.id("instances")),
    userId: v.optional(v.id("users")),
    nonceHash: v.optional(v.string()),
  },
  handler: async (ctx, { state, redirectTo, instanceId, userId, nonceHash }) => {
    if ((instanceId === undefined) !== (userId === undefined)) {
      throw new Error("An integration connect needs both the instance and the user who started it");
    }
    if ((instanceId === undefined) === (nonceHash === undefined)) {
      throw new Error("A sign-in needs a nonce hash and an integration connect must not have one");
    }
    await ctx.db.insert("twitchOAuthState", {
      state,
      // The callback page navigates here after Twitch answers.
      redirectTo: safeRelativePath(redirectTo),
      instanceId,
      userId,
      nonceHash,
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
      nonceHash: record.nonceHash ?? null,
    };
  },
});

export const storePendingAuth = internalMutation({
  args: {
    twitchId: v.string(),
    displayName: v.string(),
    email: v.string(),
    profileImage: v.string(),
    nonceHash: v.string(),
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

/**
 * Redeems a pending sign-in once. The row is deleted on every attempt, and
 * the profile is released only to the browser presenting the nonce the
 * sign-in started with, so a callback link completed elsewhere signs nobody in.
 */
export const lookupPendingAuth = internalMutation({
  args: { token: v.string(), nonceHash: v.string() },
  handler: async (ctx, { token, nonceHash }) => {
    const record = await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();

    if (!record) {
      return null;
    }
    await ctx.db.delete(record._id);
    if (Date.now() - record.createdAt > FIVE_MINUTES) {
      return null;
    }
    if (!signInNonceMatches(record.nonceHash, nonceHash)) {
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
