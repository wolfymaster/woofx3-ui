import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useCallback } from "react";
import type { TwitchChatGateway } from "@/engine/gateway";
import type { Announcement, Chatter } from "@/engine/types";
import { withPlainError } from "./errors";
import { useInstanceAction } from "./scope";

// Convex writes to chat with the broadcaster token it holds, through the
// engine when the engine advertises `twitch.chat`.

type ChatterRow = FunctionReturnType<typeof api.shoutouts.listChatters>[number];

function toChatter(chatter: ChatterRow): Chatter {
  return { userId: chatter.userId, login: chatter.login, displayName: chatter.displayName };
}

function useSendMessageRequest() {
  const sendChatMessage = useInstanceAction(api.twitchBroadcast.sendChatMessage);
  return useCallback(
    async (message: string) => {
      await sendChatMessage({ message }).catch(withPlainError);
    },
    [sendChatMessage]
  );
}

function useSendAnnouncementRequest() {
  const sendAnnouncement = useInstanceAction(api.twitchBroadcast.sendAnnouncement);
  return useCallback(
    async ({ message, color }: Announcement) => {
      await sendAnnouncement({ message, color }).catch(withPlainError);
    },
    [sendAnnouncement]
  );
}

function useSendShoutoutRequest() {
  const sendShoutout = useInstanceAction(api.twitchBroadcast.sendShoutout);
  return useCallback(
    async (login: string) => {
      await sendShoutout({ targetLogin: login }).catch(withPlainError);
    },
    [sendShoutout]
  );
}

function useChattersRequest() {
  const listChatters = useInstanceAction(api.shoutouts.listChatters);
  return useCallback(async () => (await listChatters({}).catch(withPlainError)).map(toChatter), [listChatters]);
}

export const convexTwitchChatGateway: TwitchChatGateway = {
  useSendMessageRequest,
  useSendAnnouncementRequest,
  useSendShoutoutRequest,
  useChattersRequest,
};
