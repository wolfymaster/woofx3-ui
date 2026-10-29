import {
  ANNOUNCEMENT_SCOPE,
  announcementProblem,
  chatMessageProblem,
  noShoutoutChannelMessage,
  readAnnouncementAnswer,
  readChatMessageAnswer,
  readShoutoutAnswer,
  SEND_MESSAGE_SCOPE,
  SHOUTOUT_NEEDS_CHANNEL_MESSAGE,
  SHOUTOUT_SCOPE,
} from "@shared/twitch-chat";
import { normalizeTwitchLogin } from "@shared/twitch-users";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { type AuthorizedTwitchCall, authorizeTwitch } from "./lib/twitchAuth";
import { helixResponse, type TwitchHelixRoute, twitchHelixRoute } from "./lib/twitchEngineHelix";
import { fetchTwitchUser } from "./lib/twitchUsers";

// Chat message / announce / shoutout for the dashboard's Broadcast Controls
// panel and macro pad.
//
// These go straight to Helix with the broadcaster token Convex holds, or
// through an engine that advertises twitch.chat and sends the same requests
// (convex/lib/twitchEngineHelix.ts).
// Same shape as convex/twitchClips.ts.

const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";
const TWITCH_ANNOUNCEMENTS_URL = "https://api.twitch.tv/helix/chat/announcements";
const TWITCH_SHOUTOUTS_URL = "https://api.twitch.tv/helix/chat/shoutouts";

// Twitch accepts only these five; there is no free-form announcement color.
export const ANNOUNCEMENT_COLORS = ["primary", "blue", "green", "orange", "purple"] as const;

const ANNOUNCEMENT_COLOR_VALIDATOR = v.union(
  v.literal("primary"),
  v.literal("blue"),
  v.literal("green"),
  v.literal("orange"),
  v.literal("purple")
);

/** Post a plain chat message as the broadcaster. */
export const sendChatMessage = action({
  args: {
    instanceId: v.id("instances"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    const problem = chatMessageProblem(message);
    if (problem) {
      throw new Error(problem);
    }

    const call = await authorizeTwitch(ctx, args.instanceId, SEND_MESSAGE_SCOPE);
    await postChatMessage(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.chat"), message);
    return { ok: true };
  },
});

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
  await readChatMessageAnswer(response);
}

export const sendAnnouncement = action({
  args: {
    instanceId: v.id("instances"),
    message: v.string(),
    color: ANNOUNCEMENT_COLOR_VALIDATOR,
  },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const message = args.message.trim();
    const problem = announcementProblem(message);
    if (problem) {
      throw new Error(problem);
    }

    const call = await authorizeTwitch(ctx, args.instanceId, ANNOUNCEMENT_SCOPE);
    await postAnnouncement(call, await twitchHelixRoute(ctx, args.instanceId, "twitch.chat"), message, args.color);
    return { ok: true };
  },
});

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
  await readAnnouncementAnswer(response);
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
      throw new Error(SHOUTOUT_NEEDS_CHANNEL_MESSAGE);
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
    throw new Error(noShoutoutChannelMessage(login));
  }

  const url = `${TWITCH_SHOUTOUTS_URL}?from_broadcaster_id=${broadcasterUserId}&to_broadcaster_id=${target.twitchUserId}&moderator_id=${broadcasterUserId}`;
  const response = await helixResponse(route, {
    operation: "sendShoutout",
    kind: "write",
    viaEngine: (engine) => engine.twitchSendShoutout({ to_broadcaster_id: target.twitchUserId }),
    direct: () => fetch(url, { method: "POST", headers }),
  });
  await readShoutoutAnswer(response);
}
