import {
  ANNOUNCEMENT_SCOPE,
  announcementProblem,
  CHATTERS_PAGE_SIZE,
  CHATTERS_SCOPE,
  chatMessageProblem,
  noShoutoutChannelMessage,
  readAnnouncementAnswer,
  readChatMessageAnswer,
  readChattersAnswer,
  readShoutoutAnswer,
  SEND_MESSAGE_SCOPE,
  SHOUTOUT_NEEDS_CHANNEL_MESSAGE,
  SHOUTOUT_SCOPE,
} from "@shared/twitch-chat";
import { normalizeTwitchLogin, readTwitchUserAnswer } from "@shared/twitch-users";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { TwitchChatGateway } from "@/engine/gateway";
import type { Announcement, Chatter } from "@/engine/types";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { type DirectTwitch, directTwitch } from "./twitch";

/** Posts `text` in chat as the broadcaster; rejects with Twitch's reason when it drops the message. */
export async function sendChatMessage(twitch: DirectTwitch, text: string): Promise<void> {
  const message = text.trim();
  const problem = chatMessageProblem(message);
  if (problem) {
    throw new Error(problem);
  }
  await twitch.authorize(SEND_MESSAGE_SCOPE);
  await readChatMessageAnswer(
    await twitch.helix(ENGINE_CAPABILITIES.twitchChat, "twitchSendChatMessage", (api) =>
      api.twitchSendChatMessage({ message })
    )
  );
}

/** Writing in chat as the broadcaster, and who is in it, through the engine's `twitch.chat` methods. */
export function directTwitchChatGateway(runtime: DirectRuntime): TwitchChatGateway {
  const twitch = directTwitch(runtime);
  const chat = ENGINE_CAPABILITIES.twitchChat;

  const sendMessage = (text: string): Promise<void> => sendChatMessage(twitch, text);

  const sendAnnouncement = async (announcement: Announcement): Promise<void> => {
    const message = announcement.message.trim();
    const problem = announcementProblem(message);
    if (problem) {
      throw new Error(problem);
    }
    await twitch.authorize(ANNOUNCEMENT_SCOPE);
    await readAnnouncementAnswer(
      await twitch.helix(chat, "twitchSendChatAnnouncement", (api) =>
        api.twitchSendChatAnnouncement({ message, color: announcement.color })
      )
    );
  };

  const sendShoutout = async (input: string): Promise<void> => {
    const login = normalizeTwitchLogin(input);
    if (!login) {
      throw new Error(SHOUTOUT_NEEDS_CHANNEL_MESSAGE);
    }
    await twitch.authorize(SHOUTOUT_SCOPE);
    // Helix takes the channel by id, not login.
    const channel = await readTwitchUserAnswer(
      await twitch.helix(ENGINE_CAPABILITIES.twitchModeration, "twitchGetUsers", (api) => api.twitchGetUsers({ login }))
    );
    if (!channel) {
      throw new Error(noShoutoutChannelMessage(login));
    }
    await readShoutoutAnswer(
      await twitch.helix(chat, "twitchSendShoutout", (api) =>
        api.twitchSendShoutout({ to_broadcaster_id: channel.twitchUserId })
      )
    );
  };

  const chatters = async (): Promise<Chatter[]> => {
    await twitch.authorize(CHATTERS_SCOPE);
    return readChattersAnswer(
      await twitch.helix(chat, "twitchGetChatters", (api) => api.twitchGetChatters({ first: CHATTERS_PAGE_SIZE }))
    );
  };

  return {
    useSendMessageRequest: () => useEngineRequest(sendMessage),
    useSendAnnouncementRequest: () => useEngineRequest(sendAnnouncement),
    useSendShoutoutRequest: () => useEngineRequest(sendShoutout),
    useChattersRequest: () => useEngineRequest(chatters),
  };
}
