/**
 * The lifecycle of an engine alert as Convex mirrors it, and the rules for
 * merging the engine's lifecycle callbacks into one row.
 *
 * Pure so the dashboard's counts and the webhook's merge can be tested without
 * a database, and so the client can draw a row the same way the overview
 * counts it.
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
  | "dispatched";

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
]);

export function isEngineAlertStatus(raw: string): raw is EngineAlertStatus {
  return KNOWN_STATUSES.has(raw);
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
 * and the mirror follows the engine. `replayed` sits above them: the operator
 * superseded the row, and a straggling verdict for the original play does not
 * undo that.
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
    case "completed":
    case "failed":
    case "timed_out":
    case "skipped":
      return 3;
    case "replayed":
      return 4;
  }
}

/** Whether a row holding `current` should take `incoming` from a callback. */
export function acceptsTransition(current: EngineAlertStatus, incoming: EngineAlertStatus): boolean {
  return stageOf(incoming) >= stageOf(current);
}

/**
 * How long an alert may sit without a terminal callback before the dashboard
 * stops calling it in flight.
 *
 * An alert plays for seconds, and even a long queue behind a raid drains in
 * minutes. Past this the engine has lost track of it -- an overlay closed
 * mid-play, the engine restarted, a callback was never delivered -- and no
 * callback is coming to settle it. Counting it as in flight forever would make
 * the tile grow without bound, so it is counted as unconfirmed instead.
 */
export const ALERT_IN_FLIGHT_STALE_MS = 15 * 60 * 1000;

/** What a lifecycle status counts as on the dashboard. */
export type AlertOutcome = "completed" | "failed" | "inFlight" | "unconfirmed" | "skipped" | "replayed";

/**
 * An alert's outcome for counting purposes.
 *
 * `replayed` is neither a success nor a failure: the operator superseded that
 * row, and the re-fire is its own row, so counting it either way would report
 * one alert twice.
 *
 * `startedAt` is when Convex first saw the alert (the row's `_creationTime`),
 * so the staleness bound is measured on Convex's clock, the same one as `now`.
 */
export function outcomeOf(status: EngineAlertStatus, startedAt: number, now: number): AlertOutcome {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "timed_out":
      return "failed";
    case "sent":
    case "pending":
    case "dispatched":
    case "playing":
      return now - startedAt > ALERT_IN_FLIGHT_STALE_MS ? "unconfirmed" : "inFlight";
    case "skipped":
      return "skipped";
    case "replayed":
      return "replayed";
  }
}
