import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Twitch token custody for the Convex functions that need it (twitchClips,
// twitchBroadcast). Tokens never leave the server: getTwitchLink and
// ensureFreshTwitchToken are internal-only, so a caller gets the result of a
// Twitch call, never the credential.
//
// The module name is a leftover. It also used to mint and revoke EventSub
// subscriptions for a browser that held its own socket to Twitch; stream events
// now reach the browser from the engine over capnweb instead (see
// client/src/lib/platforms/).

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

// Refresh proactively once a token is within this long of expiring.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const checkMembership = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    return !!(await getInstanceMembership(ctx, instanceId, userId));
  },
});

// Internal-only: returns the raw token row. Never exposed to a public query —
// only `ensureFreshTwitchToken` (also internal) reads it.
export const getTwitchLink = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
  },
});

export const patchTwitchToken = internalMutation({
  args: {
    linkId: v.id("platformLinks"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { linkId, ...patch }) => {
    await ctx.db.patch(linkId, patch);
  },
});

// Returns a currently-valid access token for the instance's Twitch link,
// refreshing it first if it's near expiry. Convex had no refresh logic
// before this — the engine's own copy (pushed via syncToEngine) is kept
// fresh independently by the engine's twitch service, but that doesn't help
// Convex's copy, which is what this realtime layer uses.
export const ensureFreshTwitchToken = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ accessToken: string; broadcasterUserId: string } | null> => {
    const link = await ctx.runQuery(internal.platformRealtime.getTwitchLink, { instanceId });
    if (!link) {
      return null;
    }

    if (link.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return { accessToken: link.accessToken, broadcasterUserId: link.platformUserId };
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    const clientSecret = process.env.AUTH_TWITCH_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("AUTH_TWITCH_ID/AUTH_TWITCH_SECRET env vars are not set");
    }

    const response = await fetch(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: link.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Twitch token refresh failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await ctx.runMutation(internal.platformRealtime.patchTwitchToken, {
      linkId: link._id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return { accessToken: data.access_token, broadcasterUserId: link.platformUserId };
  },
});
