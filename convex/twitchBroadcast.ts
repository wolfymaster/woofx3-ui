import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalQuery } from "./_generated/server";

// Announce / shoutout for the dashboard's Broadcast Controls panel.
//
// These go straight to Helix rather than through the engine. The engine's Api
// surface has no announcement or shoutout method (its only generic escape
// hatch is `triggerEvent`, which just publishes a CloudEvent and depends on
// some module happening to subscribe — not a dependable path), while Convex
// already holds a refreshable broadcaster token for exactly this kind of call.
// Same shape as convex/twitchClips.ts.

const TWITCH_ANNOUNCEMENTS_URL = "https://api.twitch.tv/helix/chat/announcements";
const TWITCH_SHOUTOUTS_URL = "https://api.twitch.tv/helix/chat/shoutouts";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";

const ANNOUNCEMENT_SCOPE = "moderator:manage:announcements";
const SHOUTOUT_SCOPE = "moderator:manage:shoutouts";

// Twitch accepts only these five; there is no free-form announcement color.
export const ANNOUNCEMENT_COLORS = ["primary", "blue", "green", "orange", "purple"] as const;

const ANNOUNCEMENT_COLOR_VALIDATOR = v.union(
  v.literal("primary"),
  v.literal("blue"),
  v.literal("green"),
  v.literal("orange"),
  v.literal("purple")
);

const MAX_ANNOUNCEMENT_LENGTH = 500;

interface AuthorizedCall {
  accessToken: string;
  broadcasterUserId: string;
  clientId: string;
}

/**
 * Authenticates the caller, confirms the instance's Twitch link carries the
 * scope this call needs, and returns a fresh token. The scope check is what
 * turns "Twitch silently 401s" into an actionable "reconnect Twitch" message:
 * a link created before a scope was added to TWITCH_INTEGRATION_SCOPES keeps
 * working for everything else, so the gap is invisible until it isn't.
 */
async function authorize(ctx: ActionCtx, instanceId: Id<"instances">, requiredScope: string): Promise<AuthorizedCall> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, { instanceId, userId });
  if (!isMember) {
    throw new Error("Not a member of this instance");
  }

  const scopes: string[] = await ctx.runQuery(internal.twitchBroadcast.twitchScopesFor, { instanceId });
  if (!scopes.includes(requiredScope)) {
    throw new Error(
      `Your Twitch connection is missing the "${requiredScope}" permission. Reconnect Twitch in Settings → Integrations to grant it.`
    );
  }

  const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, { instanceId });
  if (!token) {
    throw new Error("Twitch is not connected for this instance");
  }

  const clientId = process.env.AUTH_TWITCH_ID;
  if (!clientId) {
    throw new Error("AUTH_TWITCH_ID env var is not set");
  }

  return { accessToken: token.accessToken, broadcasterUserId: token.broadcasterUserId, clientId };
}

/** Scopes granted on this instance's Twitch link. Internal: the link row also
 * carries the access and refresh tokens, which must never leave the backend. */
export const twitchScopesFor = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string[]> => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return link?.scopes ?? [];
  },
});

export const sendAnnouncement = action({
  args: {
    instanceId: v.id("instances"),
    message: v.string(),
    color: ANNOUNCEMENT_COLOR_VALIDATOR,
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    if (!message) {
      throw new Error("An announcement needs a message");
    }
    if (message.length > MAX_ANNOUNCEMENT_LENGTH) {
      throw new Error(`Twitch announcements are limited to ${MAX_ANNOUNCEMENT_LENGTH} characters`);
    }

    const { accessToken, broadcasterUserId, clientId } = await authorize(ctx, args.instanceId, ANNOUNCEMENT_SCOPE);

    const url = `${TWITCH_ANNOUNCEMENTS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, color: args.color }),
    });

    if (!response.ok) {
      throw new Error(`Twitch announcement failed: ${response.status} ${await response.text()}`);
    }
    return { ok: true };
  },
});

export const sendShoutout = action({
  args: {
    instanceId: v.id("instances"),
    /** Twitch login of the channel to shout out. */
    targetLogin: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const login = args.targetLogin.trim().toLowerCase().replace(/^@/, "");
    if (!login) {
      throw new Error("A shoutout needs a channel name");
    }

    const { accessToken, broadcasterUserId, clientId } = await authorize(ctx, args.instanceId, SHOUTOUT_SCOPE);
    const headers = { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId };

    // Helix takes the target by id, not login.
    const lookup = await fetch(`${TWITCH_USERS_URL}?login=${encodeURIComponent(login)}`, { headers });
    if (!lookup.ok) {
      throw new Error(`Twitch user lookup failed: ${lookup.status} ${await lookup.text()}`);
    }
    const lookupData = (await lookup.json()) as { data: Array<{ id: string }> };
    const target = lookupData.data[0];
    if (!target) {
      throw new Error(`No Twitch channel called "${login}"`);
    }

    const url = `${TWITCH_SHOUTOUTS_URL}?from_broadcaster_id=${broadcasterUserId}&to_broadcaster_id=${target.id}&moderator_id=${broadcasterUserId}`;
    const response = await fetch(url, { method: "POST", headers });

    // Twitch rate-limits shoutouts hard (one per 2 minutes, and not to the same
    // channel within 60 minutes) and refuses when the channel isn't live.
    if (response.status === 429) {
      throw new Error("Twitch is rate-limiting shoutouts — try again in a couple of minutes.");
    }
    if (!response.ok) {
      throw new Error(`Twitch shoutout failed: ${response.status} ${await response.text()}`);
    }
    return { ok: true };
  },
});
