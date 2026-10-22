import { useEngineGateway } from "@/engine/context";

/** Posts a chat message as the broadcaster. */
export function useSendChatMessageRequest() {
  return useEngineGateway().twitchChat.useSendMessageRequest();
}

export function useSendAnnouncementRequest() {
  return useEngineGateway().twitchChat.useSendAnnouncementRequest();
}

/** Shouts out a channel now, outside the queue. */
export function useSendShoutoutRequest() {
  return useEngineGateway().twitchChat.useSendShoutoutRequest();
}

/** Reads who is in chat now. */
export function useChattersRequest() {
  return useEngineGateway().twitchChat.useChattersRequest();
}
