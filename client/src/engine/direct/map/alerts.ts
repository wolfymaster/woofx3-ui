import type { AlertSnapshot } from "@woofx3/api";
import type { EngineAlert, EngineAlertStatus } from "@/engine/types";

const STATUSES: { readonly [S in EngineAlertStatus]: true } = {
  sent: true,
  playing: true,
  completed: true,
  failed: true,
  replayed: true,
  timed_out: true,
  skipped: true,
  pending: true,
  dispatched: true,
  unknown: true,
};

/** The statuses of an alert still on its way. */
const UNSETTLED: ReadonlySet<EngineAlertStatus> = new Set(["pending", "sent", "dispatched", "playing", "unknown"]);

/**
 * How long an alert may go without the engine reporting on it before it
 * stops counting as on its way. Must match ALERT_UNCONFIRMED_AFTER_MS in
 * woofx3 api/src/alert-overview.ts, which counts the same alerts as
 * unconfirmed in its overview.
 */
export const ALERT_UNCONFIRMED_AFTER_MS = 15 * 60 * 1000;

function isStatus(raw: string): raw is EngineAlertStatus {
  return Object.hasOwn(STATUSES, raw);
}

/** An RFC 3339 time as epoch ms; throws for anything else, since the engine writes no other. */
function epochMs(field: string, raw: string): number {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new Error(`The engine sent an alert whose ${field} is not a time: ${JSON.stringify(raw)}`);
  }
  return ms;
}

/**
 * One alert as `listAlerts` returns it, read at `now`. A status a newer
 * engine writes reads as `unknown`, with the raw value in `engineStatus`.
 * An alert still on its way that the engine has not reported on for
 * `ALERT_UNCONFIRMED_AFTER_MS` is marked unconfirmed from the moment it went
 * quiet that long; nothing marks it later, so the mark is as fresh as the read.
 */
export function toEngineAlert(snapshot: AlertSnapshot, now: number): EngineAlert {
  const status = isStatus(snapshot.status) ? snapshot.status : "unknown";
  const createdAt = epochMs("createdAt", snapshot.createdAt);
  const progressedAt = epochMs("updatedAt", snapshot.updatedAt);
  const quietSince = progressedAt + ALERT_UNCONFIRMED_AFTER_MS;
  return {
    id: snapshot.id,
    engineAlertId: snapshot.id,
    status,
    payload: snapshot.payload || undefined,
    workflowId: snapshot.workflowId || undefined,
    sourceEventId: snapshot.sourceEventId || undefined,
    engineStatus: status === "unknown" ? snapshot.status : undefined,
    envelopeId: snapshot.envelopeId || undefined,
    dispatchedAt: snapshot.dispatchedAt,
    playedAt: snapshot.playedAt,
    completedAt: snapshot.completedAt,
    error: snapshot.error || undefined,
    engineCreatedAt: snapshot.createdAt,
    engineUpdatedAt: snapshot.updatedAt,
    engineVersion: snapshot.version,
    createdAt,
    progressedAt,
    unconfirmedAt: UNSETTLED.has(status) && now >= quietSince ? quietSince : undefined,
  };
}
