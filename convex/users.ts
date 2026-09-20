import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

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
