import { v } from "convex/values";
import { action } from "./_generated/server";
import { authorizeTwitch } from "./lib/twitchAuth";

// Chat message / announce / shoutout for the dashboard's Broadcast Controls
// panel and macro pad.
//
// These go straight to Helix rather than through the engine. The engine's Api
// surface has no chat message, announcement or shoutout method (its only
// generic escape hatch is `triggerEvent`, which just publishes a CloudEvent and
// depends on some module happening to subscribe — not a dependable path), while
// Convex already holds a refreshable broadcaster token for exactly this kind of
// call.
// Same shape as convex/twitchClips.ts.

const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";
const TWITCH_ANNOUNCEMENTS_URL = "https://api.twitch.tv/helix/chat/announcements";
const TWITCH_SHOUTOUTS_URL = "https://api.twitch.tv/helix/chat/shoutouts";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";

const SEND_MESSAGE_SCOPE = "user:write:chat";
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
const MAX_CHAT_MESSAGE_LENGTH = 500;

/** Post a plain chat message as the broadcaster. */
export const sendChatMessage = action({
  args: {
    instanceId: v.id("instances"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    if (!message) {
      throw new Error("A chat message needs some text");
    }
    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(`Twitch chat messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters`);
    }

    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(
      ctx,
      args.instanceId,
      SEND_MESSAGE_SCOPE
    );

    const response = await fetch(TWITCH_MESSAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ broadcaster_id: broadcasterUserId, sender_id: broadcasterUserId, message }),
    });
    if (!response.ok) {
      throw new Error(`Twitch chat message failed: ${response.status} ${await response.text()}`);
    }

    // Twitch answers 200 and still drops the message — automod, a duplicate, a
    // banned term — so success is read from the body, not the status.
    const body = (await response.json()) as {
      data?: Array<{ is_sent?: boolean; drop_reason?: { message?: string } }>;
    };
    const result = body.data?.[0];
    if (!result?.is_sent) {
      throw new Error(result?.drop_reason?.message ?? "Twitch accepted the message but did not send it");
    }
    return { ok: true };
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

    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(
      ctx,
      args.instanceId,
      ANNOUNCEMENT_SCOPE
    );

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

    const { accessToken, broadcasterUserId, clientId } = await authorizeTwitch(ctx, args.instanceId, SHOUTOUT_SCOPE);
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
