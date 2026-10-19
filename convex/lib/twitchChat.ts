import type { AuthorizedTwitchCall } from "./twitchAuth";
import { helixResponse, type TwitchHelixRoute } from "./twitchEngineHelix";

// Posting to the broadcaster's chat as the broadcaster, shared by pinning and
// the Go live announcement. Only the Helix call lives here; the caller has
// already checked membership and the user:write:chat scope via authorizeTwitch.

const TWITCH_MESSAGES_URL = "https://api.twitch.tv/helix/chat/messages";

/** Twitch rejects a chat message longer than this, so refuse before spending a call. */
export const MAX_CHAT_MESSAGE_LENGTH = 500;

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
  if (!response.ok) {
    throw new Error(`Twitch chat send failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    data?: Array<{ message_id?: string; is_sent?: boolean; drop_reason?: { code?: string; message?: string } }>;
  };
  const result = body.data?.[0];
  // Twitch answers 200 and still drops the message — automod, a duplicate, a
  // banned term. Treating that as success would record an id nobody ever saw.
  if (!result?.is_sent) {
    throw new Error(result?.drop_reason?.message ?? "Twitch accepted the message but did not send it");
  }
  if (!result.message_id) {
    throw new Error("Twitch sent the message but returned no id");
  }
  return result.message_id;
}
