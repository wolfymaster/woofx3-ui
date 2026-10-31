import { type EngineCallFailure, isSummaryInProgress, shortEngineMessage } from "@shared/stream-recap";
import { engineFailureMessage } from "@shared/supporters";
import type { StreamSession, StreamSessionTotals } from "@woofx3/api";
import { EngineDisconnectedError, EngineTimeoutError } from "@/engine/errors";
import type { InstanceLiveState, StreamRecap, StreamRecapSession, StreamRecapTotals } from "@/engine/types";
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

function toStreamRecapSession(session: StreamSession): StreamRecapSession {
  return {
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    segments: session.segments.map((segment) => ({
      id: segment.id,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    })),
  };
}

function toStreamRecapTotals(totals: StreamSessionTotals): StreamRecapTotals {
  return {
    bits: totals.bits,
    cheers: totals.cheers,
    subs: totals.subs,
    giftedSubs: totals.giftedSubs,
    follows: totals.follows,
    raids: totals.raids,
    raiders: totals.raiders,
    peakViewers: totals.peakViewers,
    averageViewers: totals.averageViewers,
    viewerSampleMinutes: totals.viewerSampleMinutes,
  };
}

/**
 * A session's recap from the engine's own reads, taken at `readAtMs`. The
 * engine answers with its live figures, so there is no stored summary and no
 * schema to outgrow, and the moment the figures describe is the read.
 */
export function toStreamRecap(
  session: StreamSession,
  totals: StreamSessionTotals,
  live: InstanceLiveState,
  readAtMs: number
): StreamRecap {
  const recapSession = toStreamRecapSession(session);
  return {
    sessionId: session.id,
    generatedAt: new Date(readAtMs).toISOString(),
    generatedAtMs: readAtMs,
    inProgress: isSummaryInProgress({ sessionId: session.id, session: recapSession }, live),
    summary: { kind: "read", session: recapSession, totals: toStreamRecapTotals(totals) },
  };
}
