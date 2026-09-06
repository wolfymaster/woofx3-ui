import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

// Direct-to-Twitch realtime layer for dashboard widgets (see
// client/src/lib/platforms/). The browser opens the EventSub WebSocket
// itself — Twitch pushes events straight to it, no engine round-trip — but
// creating/deleting a subscription needs the broadcaster's access token,
// which stays here. The browser only ever sees a session id and event type,
// never the token itself.

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_EVENTSUB_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";

// Refresh proactively once a token is within this long of expiring.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const EVENT_TYPE_VALIDATOR = v.union(
  v.literal("follow"),
  v.literal("subscribe"),
  v.literal("cheer"),
  v.literal("raid")
);

// Twitch EventSub type/version/condition per normalized event type. Scopes
// required (moderator:read:followers, channel:read:subscriptions, bits:read)
// are already part of TWITCH_INTEGRATION_SCOPES.
const EVENT_TYPE_CONFIG: Record<
  string,
  { type: string; version: string; condition: (broadcasterId: string) => Record<string, string> }
> = {
  follow: {
    type: "channel.follow",
    version: "2",
    condition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId }),
  },
  subscribe: {
    type: "channel.subscribe",
    version: "1",
    condition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId }),
  },
  cheer: {
    type: "channel.cheer",
    version: "1",
    condition: (broadcasterId) => ({ broadcaster_user_id: broadcasterId }),
  },
  raid: {
    type: "channel.raid",
    version: "1",
    condition: (broadcasterId) => ({ to_broadcaster_user_id: broadcasterId }),
  },
};

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

export const createEventSubSubscription = action({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
    eventType: EVENT_TYPE_VALIDATOR,
  },
  handler: async (ctx, args): Promise<{ subscriptionId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, {
      instanceId: args.instanceId,
      userId,
    });
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }

    const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, {
      instanceId: args.instanceId,
    });
    if (!token) {
      throw new Error("Twitch is not connected for this instance");
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    if (!clientId) {
      throw new Error("AUTH_TWITCH_ID env var is not set");
    }

    const config = EVENT_TYPE_CONFIG[args.eventType];
    const response = await fetch(TWITCH_EVENTSUB_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: config.type,
        version: config.version,
        condition: config.condition(token.broadcasterUserId),
        transport: { method: "websocket", session_id: args.sessionId },
      }),
    });

    if (!response.ok) {
      throw new Error(`Twitch EventSub subscribe failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data: Array<{ id: string }> };
    return { subscriptionId: data.data[0].id };
  },
});

export const deleteEventSubSubscription = action({
  args: {
    instanceId: v.id("instances"),
    subscriptionId: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, {
      instanceId: args.instanceId,
      userId,
    });
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }

    const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, {
      instanceId: args.instanceId,
    });
    if (!token) {
      return { success: false };
    }

    const clientId = process.env.AUTH_TWITCH_ID;
    if (!clientId) {
      throw new Error("AUTH_TWITCH_ID env var is not set");
    }

    const response = await fetch(`${TWITCH_EVENTSUB_URL}?id=${encodeURIComponent(args.subscriptionId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Client-Id": clientId,
      },
    });

    return { success: response.ok };
  },
});
