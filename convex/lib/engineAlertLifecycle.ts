/**
 * The lifecycle of an engine alert as Convex mirrors it, and the rules for
 * merging the engine's lifecycle callbacks into one row.
 *
 * Pure so the dashboard's counts and the webhook's merge can be tested without
 * a database, and so the client can draw a row the same way the overview
 * counts it.
 */

/**
 * The lifecycle values the mirror stores. All but `unknown` are the engine's
 * own; `unknown` stands in for a value this build does not recognise, with the
 * engine's raw value kept beside it on the row.
 */
export type EngineAlertStatus =
  | "sent"
  | "playing"
  | "completed"
  | "failed"
  | "replayed"
  | "timed_out"
  | "skipped"
  | "pending"
  | "dispatched"
  | "unknown";

const KNOWN_STATUSES: ReadonlySet<string> = new Set<EngineAlertStatus>([
  "sent",
  "playing",
  "completed",
  "failed",
  "replayed",
  "timed_out",
  "skipped",
  "pending",
  "dispatched",
  "unknown",
]);

export function isEngineAlertStatus(raw: string): raw is EngineAlertStatus {
  return KNOWN_STATUSES.has(raw);
}

/**
 * Callback subjects for an alert leaving the engine for the overlay and for the
 * overlay starting to play it. Must match `EngineEventType.ALERT_DISPATCHED` and
 * `EngineEventType.ALERT_PLAYING` in woofx3 `shared/clients/typescript/api/webhooks.ts`.
 * Kept here rather than read from those types because the engine types this
 * repo builds against may predate them.
 */
export const ALERT_DISPATCHED_EVENT_TYPE = "alert.dispatched";
export const ALERT_PLAYING_EVENT_TYPE = "alert.playing";

/**
 * The stored status for a raw engine value: itself when this build knows it,
 * `unknown` otherwise.
 *
 * A value from a newer engine cannot be stored as-is (the schema's status is a
 * closed union), and guessing a known status for it would be wrong either way:
 * guessing `sent` makes a cancelled alert look like it is still on its way, and
 * guessing a verdict invents one. `unknown` says only what is known.
 */
export function normaliseStatus(raw: string): EngineAlertStatus {
  return isEngineAlertStatus(raw) ? raw : "unknown";
}

/**
 * How far along an alert a status is. A status may replace another of equal
 * or higher stage, never a lower one.
 *
 * Callbacks are projected from two outbox subjects (`created` and `updated`)
 * and retried independently, so `alert.recorded` can land after the alert has
 * already finished. Ranking keeps that late snapshot from reviving a settled
 * alert. Terminal statuses share a stage because the engine lets a late
 * overlay report replace an earlier verdict (a completion after a timeout),
 * and the mirror follows the engine; `acceptsTransition` orders them by the
 * engine's timestamp. `replayed` sits above them: the operator superseded the
 * row, and a straggling verdict for the original play does not undo that.
 *
 * `unknown` ranks with the initial statuses. The engine picks a lifecycle
 * callback's subject by the status it carries, so only `alert.recorded` -- the
 * alert as it was created -- can deliver a status this build does not know.
 * Ranked low, it never settles an alert or blocks the dispatch, playback and
 * verdict that follow it; left unsettled, the staleness sweep still retires it
 * if nothing follows.
 */
function stageOf(status: EngineAlertStatus): number {
  switch (status) {
    case "pending":
    case "sent":
    case "unknown":
      return 0;
    case "dispatched":
      return 1;
    case "playing":
      return 2;
    case "completed":
    case "failed":
    case "timed_out":
    case "skipped":
      return 3;
    case "replayed":
      return 4;
  }
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/**
 * An RFC 3339 timestamp as nanoseconds since the epoch, or null when it is not
 * one.
 *
 * `Date.parse` keeps milliseconds only, and the engine writes its rows at
 * microsecond precision: two lifecycle writes in the same millisecond would
 * compare equal and the older could replace the newer. Any number of
 * fractional digits up to nine is accepted, as is any UTC offset.
 */
export function parseEngineTimestamp(raw: string): bigint | null {
  const match = RFC3339.exec(raw);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, fraction = "", zone] = match;
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const min = Number(minute);
  const s = Number(second);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || s > 60) {
    return null;
  }
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    offsetMinutes = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)));
  }
  const epochMs = Date.UTC(Number(year), m - 1, d, h, min, s) - offsetMinutes * 60_000;
  return BigInt(epochMs) * 1_000_000n + BigInt(fraction.padEnd(9, "0"));
}

/** One snapshot of an alert: its status and the engine's last write to the row. */
export interface AlertLifecyclePoint {
  status: EngineAlertStatus;
  /** The engine row's `updated_at`, an RFC 3339 string. */
  engineUpdatedAt: string;
}

/**
 * Whether a row holding `current` should take `incoming` from a callback.
 *
 * Refused when the status would move backwards, or when the engine wrote the
 * incoming snapshot before the stored one: two verdicts share a stage, so only
 * the timestamp tells an out-of-order retry of the older one from a real late
 * verdict. An identical timestamp is the same engine write delivered again, so
 * it is accepted and changes nothing. A timestamp that does not parse is not
 * evidence of order, so the comparison is skipped and the stage alone decides.
 */
export function acceptsTransition(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): boolean {
  if (stageOf(incoming.status) < stageOf(current.status)) {
    return false;
  }
  const currentAt = parseEngineTimestamp(current.engineUpdatedAt);
  const incomingAt = parseEngineTimestamp(incoming.engineUpdatedAt);
  if (currentAt !== null && incomingAt !== null && incomingAt < currentAt) {
    return false;
  }
  return true;
}

/**
 * How long an alert may go without the mirror hearing it move before it stops
 * counting as in flight, measured on Convex's clock from the row's
 * `progressedAt`.
 *
 * An alert plays for seconds, and the engine reports it leaving for the overlay,
 * starting to play and finishing. Past this bound the engine has lost track of
 * it -- an overlay closed mid-play, the engine restarted, a callback was never
 * delivered -- and no callback is coming to settle it. Counting it as in flight
 * forever would make the tile grow without bound, so the sweep marks it
 * unconfirmed instead.
 *
 * One bound covers every unsettled status, `pending` included. The engine does
 * not hold an alert back waiting for an overlay (one with no running scene to
 * play on fails at once), and an engine that predates the dispatch and playing
 * callbacks still sends its verdict within seconds of creating the alert. The
 * mark is not final either way: any later progress clears it, so an alert that
 * does wait longer returns to its real state the moment the engine reports it.
 */
export const ALERT_IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

/** The statuses of an alert the mirror has not yet seen settle. */
export const UNSETTLED_STATUSES = [
  "pending",
  "sent",
  "dispatched",
  "playing",
  "unknown",
] as const satisfies readonly EngineAlertStatus[];

/** What an alert that has finished counts as on the dashboard. */
export type SettledOutcome = "completed" | "failed" | "skipped" | "replayed";

/** What an alert counts as on the dashboard. */
export type AlertOutcome = SettledOutcome | "inFlight" | "unconfirmed";

/**
 * What a status counts as once the alert is done with, or null while it is
 * still on its way.
 *
 * `replayed` is neither a success nor a failure: the operator superseded that
 * row, and the re-fire is its own row, so counting it either way would report
 * one alert twice. `unknown` is not settled; see `stageOf`.
 */
export function settledOutcomeOf(status: EngineAlertStatus): SettledOutcome | null {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "timed_out":
      return "failed";
    case "skipped":
      return "skipped";
    case "replayed":
      return "replayed";
    case "pending":
    case "sent":
    case "dispatched":
    case "playing":
    case "unknown":
      return null;
  }
}

/**
 * Whether an alert ended badly. Takes any string because the client holds
 * statuses as plain strings; one this build does not know is not a failure.
 */
export function isFailureStatus(status: string): boolean {
  return isEngineAlertStatus(status) && settledOutcomeOf(status) === "failed";
}

/**
 * An alert's outcome for counting purposes, from stored state alone.
 *
 * `unconfirmedAt` is set by the staleness sweep (`engineAlerts.markStaleAlerts`)
 * on Convex's clock and cleared by the next progress, so the viewer's clock
 * never decides whether an alert is still on its way.
 */
export function outcomeOf(alert: { status: EngineAlertStatus; unconfirmedAt?: number }): AlertOutcome {
  const settled = settledOutcomeOf(alert.status);
  if (settled !== null) {
    return settled;
  }
  return alert.unconfirmedAt === undefined ? "inFlight" : "unconfirmed";
}

/** The engine's `AlertSnapshot`, in the shape `engineAlerts` stores it from. */
export interface EngineAlertSnapshot {
  id: string;
  payload: string;
  workflowId?: string;
  sourceEventId?: string;
  status: string;
  envelopeId?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const SNAPSHOT_REQUIRED = ["id", "payload", "status", "createdAt", "updatedAt"] as const;
const SNAPSHOT_OPTIONAL = [
  "workflowId",
  "sourceEventId",
  "envelopeId",
  "dispatchedAt",
  "playedAt",
  "completedAt",
  "error",
] as const;

/**
 * The alert snapshot a callback carries, or null when it is not one.
 *
 * For callbacks this repo cannot type from the engine's package (see
 * `ALERT_DISPATCHED_EVENT_TYPE`). Only the snapshot's known fields are copied,
 * so a field a newer engine adds does not fail the mutation's validator.
 */
export function readAlertSnapshot(value: unknown): EngineAlertSnapshot | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const snapshot: Record<string, string> = {};
  for (const key of SNAPSHOT_REQUIRED) {
    const field = source[key];
    if (typeof field !== "string") {
      return null;
    }
    snapshot[key] = field;
  }
  for (const key of SNAPSHOT_OPTIONAL) {
    const field = source[key];
    if (field === undefined) {
      continue;
    }
    if (typeof field !== "string") {
      return null;
    }
    snapshot[key] = field;
  }
  return snapshot as unknown as EngineAlertSnapshot;
}
