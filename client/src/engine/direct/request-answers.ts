import {
  type EngineRequestAnswer,
  EngineRequestType,
  type RelayCredentialRequestedResponse,
  type RequestEnvelope,
} from "@woofx3/api";
import type { Logger } from "@/lib/engine-session/deps";

/**
 * How a client driving the engine directly answers each engine request. None
 * of them is this client's to serve: the engine asks a client only for what
 * it handed the engine, and this one hands over no Twitch token, relay or
 * shoutout queue. Each answer says so plainly, so the engine logs a refusal
 * instead of waiting out its request timeout.
 */
export const REQUEST_ANSWERS: { readonly [T in EngineRequestType]: EngineRequestAnswer } = {
  // Asked only of the dashboard that sent the engine its Twitch token. A link
  // made with the engine's device login refreshes inside the engine.
  [EngineRequestType.TWITCH_TOKEN_REQUESTED]: { ok: false, error: "this client holds no Twitch tokens" },
  // A local engine reaches local endpoints itself, with no companion bridge;
  // `relay: null` tells it to clear any relay configuration.
  [EngineRequestType.RELAY_CREDENTIAL_REQUESTED]: {
    ok: true,
    body: { relay: null } satisfies RelayCredentialRequestedResponse,
  },
  [EngineRequestType.SHOUTOUT_ENQUEUE_REQUESTED]: { ok: false, error: "this client keeps no shoutout queue" },
};

/** The answer to `envelope`. A type this build does not know, from a newer engine, is refused by name. */
export function answerFor(envelope: RequestEnvelope, logger: Logger): EngineRequestAnswer {
  if (Object.hasOwn(REQUEST_ANSWERS, envelope.type)) {
    return REQUEST_ANSWERS[envelope.type];
  }
  logger.warn("DirectConnection: refused an unknown engine request", { id: envelope.id, type: envelope.type });
  return { ok: false, error: `unknown request ${envelope.type}` };
}
