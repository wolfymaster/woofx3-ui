import { type EngineCallFailure, shortEngineMessage } from "@shared/stream-recap";
import { engineFailureMessage } from "@shared/supporters";
import { EngineDisconnectedError, EngineTimeoutError } from "@/engine/errors";
import type { SessionState } from "@/lib/engine-session/EngineSession";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a recap can say about a read that failed: refused when the engine
 * turned this client's credentials away, unreachable when no session could
 * carry the call or the engine never answered it, failed when the engine
 * answered with an error of its own.
 */
export function toEngineCallFailure(error: unknown, session: SessionState): EngineCallFailure {
  if (session.status === "refused" && session.reason === "credentials") {
    return { status: "rejected" };
  }
  if (error instanceof EngineDisconnectedError || error instanceof EngineTimeoutError) {
    return { status: "unreachable", message: shortEngineMessage(messageOf(error)) };
  }
  return { status: "failed", message: shortEngineMessage(messageOf(error)) };
}

/**
 * The supporter reads' failure: a lost or silent session as it is, so a
 * screen can tell it from a refusal, and anything the engine said in the
 * words the Supporters page shows.
 */
export function toSupporterReadError(what: string, error: unknown): Error {
  if (error instanceof EngineDisconnectedError || error instanceof EngineTimeoutError) {
    return error;
  }
  return new Error(engineFailureMessage(what, error), { cause: error });
}
