import { readSentMessageIdAnswer, SEND_MESSAGE_SCOPE } from "@shared/twitch-chat";
import {
  PIN_MANAGE_SCOPE,
  PIN_READ_SCOPE,
  pinnedMessageProblem,
  readCurrentPinAnswer,
  readUnpinAnswer,
} from "@shared/twitch-pins";
import { ENGINE_CAPABILITIES } from "@woofx3/api";
import type { PinsGateway } from "@/engine/gateway";
import type { CurrentPin, PinnedMessage } from "@/engine/types";
import { toCurrentPin } from "./map/twitch";
import { useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { directTwitch } from "./twitch";
import { unsupportedRead, unsupportedRequest } from "./unsupported";

/**
 * The chat's one pin, through the engine's `twitch.pins` methods. The pin
 * history is the dashboard's own record, kept in the account: the engine
 * keeps none, so nothing here reads or adds to it, and re-pinning from it
 * cannot be offered.
 */
export function directPinsGateway(runtime: DirectRuntime): PinsGateway {
  const twitch = directTwitch(runtime);
  const pins = ENGINE_CAPABILITIES.twitchPins;

  const current = async (): Promise<CurrentPin | null> => {
    await twitch.authorize(PIN_READ_SCOPE);
    const pin = await readCurrentPinAnswer(
      await twitch.helix(pins, "twitchGetChatPins", (api) => api.twitchGetChatPins())
    );
    return pin ? toCurrentPin(pin) : null;
  };

  const pinNew = async (input: string): Promise<PinnedMessage> => {
    const text = input.trim();
    const problem = pinnedMessageProblem(text);
    if (problem) {
      throw new Error(problem);
    }
    // Both scopes are needed: one to post the message, one to pin it.
    await twitch.authorize(SEND_MESSAGE_SCOPE);
    await twitch.authorize(PIN_MANAGE_SCOPE);
    const messageId = await readSentMessageIdAnswer(
      await twitch.helix(pins, "twitchSendChatMessage", (api) =>
        api.twitchSendChatMessage({ message: text, pin: true })
      )
    );
    return { messageId };
  };

  const unpin = async (messageId: string): Promise<void> => {
    await twitch.authorize(PIN_MANAGE_SCOPE);
    await readUnpinAnswer(
      await twitch.helix(pins, "twitchUnpinChatMessage", (api) => api.twitchUnpinChatMessage({ message_id: messageId }))
    );
  };

  return {
    useHistory: unsupportedRead("pins.useHistory"),
    useCurrentRequest: () => useEngineRequest(current),
    usePinNewRequest: () => useEngineRequest(pinNew),
    useRepinRequest: unsupportedRequest("pins.useRepinRequest"),
    useUnpinRequest: () => useEngineRequest(unpin),
    useRemoveFromHistoryRequest: unsupportedRequest("pins.useRemoveFromHistoryRequest"),
  };
}
