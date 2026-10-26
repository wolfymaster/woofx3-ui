import { v } from "convex/values";
import { action } from "./_generated/server";
import {
  type ChatRoute,
  chatRoute,
  idempotencyKeys,
  sendThroughGateway,
  serverOperationId,
  undeliveredError,
} from "./lib/platformGateway";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";
import { fetchTwitchUser, normalizeTwitchLogin } from "./lib/twitchUsers";

// Chat message / announce / shoutout for the dashboard's Broadcast Controls
// panel and macro pad.
//
// Chat messages and announcements go through the engine's platform gateway
// when it advertises platform.gateway (convex/lib/platformGateway.ts).
// Otherwise, and for shoutouts, they go straight to Helix with the broadcaster
// token Convex holds, or through an engine that advertises twitch.chat and
// sends the same requests (convex/lib/twitchEngineHelix.ts).
// Same shape as convex/twitchClips.ts.

const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";
const TWITCH_ANNOUNCEMENTS_URL = "https://api.twitch.tv/helix/chat/announcements";
const TWITCH_SHOUTOUTS_URL = "https://api.twitch.tv/helix/chat/shoutouts";

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
    /** One id per user intent, so a repeated click replays the first send instead of posting twice. */
    operationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    if (!message) {
      throw new Error("A chat message needs some text");
    }
    if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
      throw new Error(`Twitch chat messages are limited to ${MAX_CHAT_MESSAGE_LENGTH} characters`);
    }

    const key = idempotencyKeys("dashboard", args.operationId, serverOperationId)("chat.send");
    const call = await authorizeTwitch(ctx, args.instanceId, SEND_MESSAGE_SCOPE);
    await sendChatLine(call, await chatRoute(ctx, args.instanceId, "twitch.chat"), message, key);
    return { ok: true };
  },
});

/** Posts `message` to chat on `route`; throws a sentence for a line that was not posted. */
export async function sendChatLine(
  call: AuthorizedTwitchCall,
  route: ChatRoute,
  message: string,
  key: string
): Promise<void> {
  if (route.kind === "helix") {
    await postChatMessage(call, route.helix, message);
    return;
  }
  const outcome = await sendThroughGateway(route, {
    action: "chat.send",
    platforms: ["twitch"],
    payload: { message },
    idempotencyKey: key,
  });
  if (outcome.kind !== "delivered") {
    throw undeliveredError(outcome, "chat message");
  }
}

export async function postChatMessage(
  { accessToken, broadcasterUserId, clientId }: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  message: string
): Promise<void> {
  const response = await helixResponse(route, {
    operation: "sendChatMessage",
    kind: "write",
    viaEngine: (engine) => engine.twitchSendChatMessage({ message }),
    direct: () =>
      fetch(TWITCH_MESSAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ broadcaster_id: broadcasterUserId, sender_id: broadcasterUserId, message }),
      }),
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
}

export const sendAnnouncement = action({
  args: {
    instanceId: v.id("instances"),
    message: v.string(),
    color: ANNOUNCEMENT_COLOR_VALIDATOR,
    /** One id per user intent, so a repeated click replays the first send instead of posting twice. */
    operationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    if (!message) {
      throw new Error("An announcement needs a message");
    }
    if (message.length > MAX_ANNOUNCEMENT_LENGTH) {
      throw new Error(`Twitch announcements are limited to ${MAX_ANNOUNCEMENT_LENGTH} characters`);
    }

    const key = idempotencyKeys("dashboard", args.operationId, serverOperationId)("chat.announce");
    const call = await authorizeTwitch(ctx, args.instanceId, ANNOUNCEMENT_SCOPE);
    await sendAnnouncementLine(call, await chatRoute(ctx, args.instanceId, "twitch.chat"), message, args.color, key);
    return { ok: true };
  },
});

/** Posts an announcement on `route`; throws a sentence for one that was not posted. */
export async function sendAnnouncementLine(
  call: AuthorizedTwitchCall,
  route: ChatRoute,
  message: string,
  color: (typeof ANNOUNCEMENT_COLORS)[number],
  key: string
): Promise<void> {
  if (route.kind === "helix") {
    await postAnnouncement(call, route.helix, message, color);
    return;
  }
  const outcome = await sendThroughGateway(route, {
    action: "chat.announce",
    platforms: ["twitch"],
    payload: { message },
    options: { twitch: { color } },
    idempotencyKey: key,
  });
  if (outcome.kind !== "delivered") {
    throw undeliveredError(outcome, "announcement");
  }
}

export async function postAnnouncement(
  { accessToken, broadcasterUserId, clientId }: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  message: string,
  color: (typeof ANNOUNCEMENT_COLORS)[number]
): Promise<void> {
  const url = `${TWITCH_ANNOUNCEMENTS_URL}?broadcaster_id=${broadcasterUserId}&moderator_id=${broadcasterUserId}`;
  const response = await helixResponse(route, {
    operation: "sendChatAnnouncement",
    kind: "write",
    viaEngine: (engine) => engine.twitchSendChatAnnouncement({ message, color }),
    direct: () =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": clientId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, color }),
      }),
  });

  if (!response.ok) {
    throw new Error(`Twitch announcement failed: ${response.status} ${await response.text()}`);
  }
}

export const sendShoutout = action({
  args: {
    instanceId: v.id("instances"),
    /** Twitch login of the channel to shout out. */
    targetLogin: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const login = normalizeTwitchLogin(args.targetLogin);
    if (!login) {
      throw new Error("A shoutout needs a channel name");
    }

    const call = await authorizeTwitch(ctx, args.instanceId, SHOUTOUT_SCOPE);
    await postShoutout(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.chat"), login);
    return { ok: true };
  },
});

export async function postShoutout(
  { accessToken, broadcasterUserId, clientId }: AuthorizedTwitchCall,
  route: TwitchHelixRoute,
  login: string
): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Client-Id": clientId };

  // Helix takes the target by id, not login.
  const target = await fetchTwitchUser({ accessToken, clientId }, { login }, route);
  if (!target) {
    throw new Error(`No Twitch channel called "${login}"`);
  }

  const url = `${TWITCH_SHOUTOUTS_URL}?from_broadcaster_id=${broadcasterUserId}&to_broadcaster_id=${target.twitchUserId}&moderator_id=${broadcasterUserId}`;
  const response = await helixResponse(route, {
    operation: "sendShoutout",
    kind: "write",
    viaEngine: (engine) => engine.twitchSendShoutout({ to_broadcaster_id: target.twitchUserId }),
    direct: () => fetch(url, { method: "POST", headers }),
  });

  // Twitch rate-limits shoutouts hard (one per 2 minutes, and not to the same
  // channel within 60 minutes) and refuses when the channel isn't live.
  if (response.status === 429) {
    throw new Error("Twitch is rate-limiting shoutouts — try again in a couple of minutes.");
  }
  if (!response.ok) {
    throw new Error(`Twitch shoutout failed: ${response.status} ${await response.text()}`);
  }
}
