import { getAuthUserId, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery, mutation, query } from "./_generated/server";

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return ctx.db.get(userId);
  },
});

/** A Twitch login is 3–25 of these; anything else is a display name that cannot be one. */
const TWITCH_LOGIN = /^[A-Za-z0-9_]{3,25}$/;

/**
 * The Twitch channel to configure on a new managed engine, or null when we do
 * not know one. Only a user who signed in through Twitch has a channel to
 * offer, and only their display name is stored — usable when it is the login
 * in different case, which it is unless they set a name outside that character
 * set.
 *
 * Guessing wrong would point the engine's chat and EventSub at someone else's
 * channel, so an unusable name yields null and the engine waits for the
 * streamer to link Twitch instead.
 */
export const twitchChannelForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string | null> => {
    const twitchAccount = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "twitch"))
      .first();
    if (!twitchAccount) {
      return null;
    }
    const user = await ctx.db.get(userId);
    const name = user?.name?.trim();
    if (!name || !TWITCH_LOGIN.test(name)) {
      return null;
    }
    return name.toLowerCase();
  },
});

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** Must match PASSWORD_MIN_LENGTH in the client's register-error.ts and the Password provider's own minimum. */
export const PASSWORD_MIN_LENGTH = 8;

/** How the signed-in user proves who they are, so Settings offers only what applies. */
export const signInMethods = query({
  args: {},
  handler: async (ctx): Promise<{ password: boolean; twitch: boolean } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const hasAccount = async (provider: string) =>
      (await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", provider))
        .first()) !== null;
    return { password: await hasAccount("password"), twitch: await hasAccount("twitch") };
  },
});

/**
 * Sets the signed-in user's display name. A Twitch sign-in's name is the
 * channel `twitchChannelForUser` hands to a new managed engine, so those users
 * keep the name Twitch gave them rather than risk pointing an engine at
 * someone else's channel.
 */
export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const name = args.name.trim();
    if (!name || name.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new Error(`A display name is 1 to ${DISPLAY_NAME_MAX_LENGTH} characters`);
    }
    const twitch = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "twitch"))
      .first();
    if (twitch) {
      throw new Error("Your display name comes from Twitch");
    }
    await ctx.db.patch(userId, { name });
  },
});

export const passwordAccountId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string | null> => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "password"))
      .first();
    return account?.providerAccountId ?? null;
  },
});

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; reason: "no_password" | "wrong_password" | "weak_password" };

/**
 * Changes the signed-in user's password after checking the current one.
 * Expected refusals come back as a reason because a production Convex redacts
 * thrown messages to a bare "Server Error".
 */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<ChangePasswordResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const email = await ctx.runQuery(internal.users.passwordAccountId, { userId });
    if (!email) {
      return { ok: false, reason: "no_password" };
    }
    if (args.newPassword.length < PASSWORD_MIN_LENGTH) {
      return { ok: false, reason: "weak_password" };
    }
    try {
      await retrieveAccount(ctx, { provider: "password", account: { id: email, secret: args.currentPassword } });
    } catch {
      // retrieveAccount throws when the secret does not match; that is the only expected failure here.
      return { ok: false, reason: "wrong_password" };
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: email, secret: args.newPassword },
    });
    return { ok: true };
  },
});
