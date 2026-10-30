import { readSentMessageIdAnswer } from "@shared/twitch-chat";
import type { AuthorizedTwitchCall } from "./twitchAuth";
import { helixResponse, type TwitchHelixRoute } from "./twitchEngineHelix";

// Posting to the broadcaster's chat as the broadcaster, shared by pinning and
// the Go live announcement. Only the Helix call lives here; the caller has
// already checked membership and the user:write:chat scope via authorizeTwitch.

const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";

/**
 * Posts `text` to chat, pinning it in the same request when asked, and
 * returns the new message id. `route` decides whether the engine sends it; a
 * pinned send needs a route to an engine with twitch.pins.
 */
export async function sendChatMessage(
  twitch: AuthorizedTwitchCall,
  text: string,
  options: { pin: boolean },
  route: TwitchHelixRoute
): Promise<string> {
  const response = await helixResponse(route, {
    operation: options.pin ? "sendChatMessage(pin)" : "sendChatMessage",
    kind: "write",
    viaEngine: (engine) => engine.twitchSendChatMessage({ message: text, ...(options.pin ? { pin: true } : {}) }),
    direct: () =>
      fetch(TWITCH_MESSAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${twitch.accessToken}`,
          "Client-Id": twitch.clientId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broadcaster_id: twitch.broadcasterUserId,
          sender_id: twitch.broadcasterUserId,
          message: text,
          ...(options.pin ? { pin: true } : {}),
        }),
      }),
  });
  return readSentMessageIdAnswer(response);
}
