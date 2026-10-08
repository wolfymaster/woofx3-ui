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
 * `unknown` sits between playing and the verdicts. Only the engine's `updated`
 * subject produces a status other than the initial one, so an unrecognised
 * value is most likely a newer kind of ending: it moves an alert out of flight,
 * but it never overwrites a verdict this build understands.
 */
function stageOf(status: EngineAlertStatus): number {
  switch (status) {
    case "pending":
    case "sent":
      return 0;
    case "dispatched":
      return 1;
    case "playing":
      return 2;
    case "unknown":
      return 3;
    case "completed":
    case "failed":
    case "timed_out":
    case "skipped":
      return 4;
    case "replayed":
      return 5;
  }
}

/** One snapshot of an alert: its status and the engine's last write to the row. */
export interface AlertLifecyclePoint {
  status: EngineAlertStatus;
  /** The engine row's `updated_at`, an ISO 8601 string. */
  engineUpdatedAt: string;
}

/**
 * Whether a row holding `current` should take `incoming` from a callback.
 *
 * Refused when the status would move backwards, or when the engine wrote the
 * incoming snapshot before the stored one: two verdicts share a stage, so only
 * the timestamp tells an out-of-order retry of the older one from a real late
 * verdict. An identical timestamp is accepted so a redelivery stays a no-op
 * rather than an error. A timestamp that does not parse is not evidence of
 * order, so the comparison is skipped and the stage alone decides.
 */
export function acceptsTransition(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): boolean {
  if (stageOf(incoming.status) < stageOf(current.status)) {
    return false;
  }
  const currentAt = Date.parse(current.engineUpdatedAt);
  const incomingAt = Date.parse(incoming.engineUpdatedAt);
  if (Number.isFinite(currentAt) && Number.isFinite(incomingAt) && incomingAt < currentAt) {
    return false;
  }
  return true;
}

/**
 * How long an alert handed to the overlay may sit without a verdict before the
 * dashboard stops calling it in flight.
 *
 * An alert plays for seconds, and the engine times out a dispatch it hears
 * nothing back about well inside this. Past it the engine has lost track of
 * the alert -- an overlay closed mid-play, the engine restarted, a callback
 * was never delivered -- and no callback is coming to settle it. Counting it as
 * in flight forever would make the tile grow without bound, so it is counted
 * as unconfirmed instead.
 */
export const ALERT_IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

/**
 * The same bound for an alert still waiting in the engine's queue.
 *
 * A queued alert is legitimately idle for as long as no overlay is connected
 * -- a break with the browser source hidden, a scene without it -- and the
 * engine keeps its queue across restarts, so the verdict does come once an
 * overlay reconnects. Holding it to the dispatch bound would label a whole
 * break's worth of alerts unconfirmed while they are still on their way. It is
 * still bounded, because the mirror hears nothing when the engine dispatches a
 * queued alert, so one lost after dispatch would otherwise sit in flight forever.
 */
export const ALERT_QUEUED_STALE_MS = 6 * 60 * 60 * 1000;

/** What an alert that has finished counts as on the dashboard. */
export type SettledOutcome = "completed" | "failed" | "skipped" | "replayed" | "unknown";

/** What a lifecycle status counts as on the dashboard. */
export type AlertOutcome = SettledOutcome | "inFlight" | "unconfirmed";

/**
 * What a status counts as once the alert is done with, or null while it is
 * still on its way.
 *
 * `replayed` is neither a success nor a failure: the operator superseded that
 * row, and the re-fire is its own row, so counting it either way would report
 * one alert twice. `unknown` is its own outcome for the same reason: counting
 * a status this build cannot read as either would be a guess.
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
    case "unknown":
      return "unknown";
    case "pending":
    case "sent":
    case "dispatched":
    case "playing":
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
 * When the mirror last saw the alert move, on Convex's clock.
 *
 * A row without `progressedAt` falls back to when it was created, the first
 * progress the mirror saw of it.
 */
export function lastProgressAt(row: { progressedAt?: number; _creationTime: number }): number {
  return row.progressedAt ?? row._creationTime;
}

/**
 * An alert's outcome for counting purposes.
 *
 * `progressedAt` is when the mirror last saw the alert move (see
 * `lastProgressAt`). It is on Convex's clock rather than the engine's because
 * an engine can be self-hosted with a clock of its own, and `now` comes from
 * the viewer's browser or Convex, never from the engine.
 */
export function outcomeOf(status: EngineAlertStatus, progressedAt: number, now: number): AlertOutcome {
  const settled = settledOutcomeOf(status);
  if (settled !== null) {
    return settled;
  }
  const bound = status === "pending" ? ALERT_QUEUED_STALE_MS : ALERT_IN_FLIGHT_STALE_MS;
  return now - progressedAt > bound ? "unconfirmed" : "inFlight";
}
