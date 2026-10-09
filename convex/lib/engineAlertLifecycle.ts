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
 * Callback subject for an overlay starting to play an alert. Must match
 * `EngineEventType.ALERT_PLAYING` in woofx3 `shared/clients/typescript/api/webhooks.ts`.
 * Kept here rather than read from those types because the engine types this
 * repo builds against may predate it.
 */
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
 * How far along an alert a status is. See `mergeLifecycle` for which moves
 * between stages the mirror takes.
 *
 * Callbacks are projected from two outbox subjects (`created` and `updated`)
 * and retried independently, so `alert.recorded` can land after the alert has
 * already finished. Ranking keeps that late snapshot from reviving a settled
 * alert. Verdicts share a stage; `mergeLifecycle` says which may replace
 * which. `replayed` sits above them: the operator superseded the row, and a straggling verdict for
 * the original play does not undo that.
 *
 * `unknown` ranks with the initial statuses. The engine picks a lifecycle
 * callback's subject by the status it carries, so only `alert.recorded` -- the
 * alert as it was created -- can deliver a status this build does not know.
 * Ranked low, it never settles an alert or blocks the playback and verdict
 * that follow it; left unsettled, the staleness sweep still retires it if
 * nothing follows.
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
  /** The engine row's `version`, when the engine sends one. */
  engineVersion?: number;
  /** The engine row's `updated_at`, an RFC 3339 string. */
  engineUpdatedAt: string;
  error?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
}

/**
 * Whether `incoming` is a later engine write than `current` (1), an earlier
 * one (-1), the same write (0), or cannot be ordered (null).
 *
 * By version when both carry one: the engine increments it on every write it
 * publishes. Otherwise by `updatedAt`, at full precision, so the same instant
 * written at different precisions is the same write; null when either
 * timestamp does not parse.
 */
export function compareEngineWrites(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): -1 | 0 | 1 | null {
  if (current.engineVersion !== undefined && incoming.engineVersion !== undefined) {
    return orderOf(incoming.engineVersion, current.engineVersion);
  }
  const currentAt = parseEngineTimestamp(current.engineUpdatedAt);
  const incomingAt = parseEngineTimestamp(incoming.engineUpdatedAt);
  if (currentAt === null || incomingAt === null) {
    return null;
  }
  return orderOf(incomingAt, currentAt);
}

function orderOf<N extends number | bigint>(a: N, b: N): -1 | 0 | 1 {
  if (a > b) {
    return 1;
  }
  if (a < b) {
    return -1;
  }
  return 0;
}

const VERDICT_STAGE = stageOf("completed");

/**
 * Whether the engine's lifecycle lets a row at `from` move to `to`. Must match
 * `transitionUpdateSQL` in woofx3 `db/database/repository/alert_repository.go`.
 *
 * A row moves only to a later stage, so the first verdict wins, with two
 * exceptions: `completed` replaces any other verdict (one widget playing an
 * alert to the end means viewers saw it), and `failed` or `skipped` replace
 * `timed_out` (the timeout is the engine giving up on hearing back). `replayed`
 * follows anything but itself.
 *
 * Applied only to snapshots that carry a version: an engine that sends one
 * enforces this rule and publishes only the writes it applies.
 */
function engineRuleAllows(from: EngineAlertStatus, to: EngineAlertStatus): boolean {
  const fromStage = stageOf(from);
  const toStage = stageOf(to);
  if (toStage > fromStage) {
    return true;
  }
  if (fromStage !== VERDICT_STAGE || toStage !== VERDICT_STAGE || from === to) {
    return false;
  }
  return to === "completed" || from === "timed_out";
}

/**
 * Whether `incoming` holds the same lifecycle as `current`: the same write
 * delivered again, as far as the mirror stores it.
 */
function sameLifecycle(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): boolean {
  return (
    current.status === incoming.status &&
    current.engineUpdatedAt === incoming.engineUpdatedAt &&
    (current.error || undefined) === (incoming.error || undefined) &&
    current.dispatchedAt === incoming.dispatchedAt &&
    current.playedAt === incoming.playedAt &&
    current.completedAt === incoming.completedAt
  );
}

/**
 * What merging a callback's snapshot into a row does:
 *
 * - `apply`: store `merged`. `progressed` is whether the alert moved -- its
 *   status changed, or this is a later engine write. A redelivery is not
 *   progress; counting it would keep an alert the engine lost track of in
 *   flight indefinitely.
 * - `keep`: the row keeps what it has, because the snapshot is the write it
 *   holds or an earlier one. Expected under retries; nothing to report.
 * - `diverged`: the row keeps what it has although the snapshot claims to be a
 *   later write, or the same version with different contents. The engine
 *   should never send one, so the caller logs it.
 */
export type LifecycleMerge<T> =
  | { kind: "apply"; merged: T; progressed: boolean }
  | { kind: "keep" }
  | { kind: "diverged"; reason: string };

/**
 * Merge a callback's `incoming` snapshot into a row holding `current`.
 *
 * Callbacks are projected from two outbox subjects and retried independently,
 * so they arrive late, twice, and out of order. An earlier write than the row
 * holds is always kept out: it would move the row back and unset lifecycle
 * timestamps it already holds.
 *
 * A snapshot with a version comes from an engine that enforces the lifecycle
 * rule (see `engineRuleAllows`), so the mirror applies that rule too, and an
 * equal version must be the identical snapshot.
 *
 * A snapshot without one comes from an engine that predates the rule, or an
 * outbox row written before the upgrade. Such an engine let a later verdict
 * correct an earlier one, so the mirror keeps its order: anything but a move
 * to an earlier stage applies, last write wins. Storing it drops the row's
 * version, which no longer describes the data it holds: a later redelivery of
 * that version is then ordered by `updatedAt` against the newer data.
 */
export function mergeLifecycle<T extends AlertLifecyclePoint>(
  current: AlertLifecyclePoint,
  incoming: T
): LifecycleMerge<T> {
  const order = compareEngineWrites(current, incoming);
  if (order === -1) {
    return { kind: "keep" };
  }
  const merged = { ...incoming, engineVersion: incoming.engineVersion };
  const progressed =
    current.status !== incoming.status ||
    order === 1 ||
    (order === null && current.engineUpdatedAt !== incoming.engineUpdatedAt);

  if (incoming.engineVersion === undefined) {
    if (stageOf(incoming.status) < stageOf(current.status)) {
      return refused(order, `${current.status} cannot move back to ${incoming.status}`);
    }
    return { kind: "apply", merged, progressed };
  }

  if (order === 0 && sameLifecycle(current, incoming)) {
    if (current.engineVersion === incoming.engineVersion) {
      return { kind: "keep" };
    }
    return { kind: "apply", merged, progressed: false };
  }
  if (order === 0 && current.engineVersion !== undefined) {
    return { kind: "diverged", reason: `version ${incoming.engineVersion} arrived with different contents` };
  }
  if (!engineRuleAllows(current.status, incoming.status)) {
    return refused(order, `the lifecycle rule refuses ${current.status} to ${incoming.status}`);
  }
  return { kind: "apply", merged, progressed };
}

/**
 * A refused snapshot: a divergence when it is a later write than the row's,
 * since the engine would not have published it; otherwise one the row may
 * well have moved past.
 */
function refused<T>(order: 0 | 1 | null, reason: string): LifecycleMerge<T> {
  return order === 1 ? { kind: "diverged", reason } : { kind: "keep" };
}

/**
 * How long an alert may go without the mirror hearing it move before it stops
 * counting as in flight, measured on Convex's clock from the row's
 * `progressedAt`.
 *
 * An alert plays for seconds, and the engine reports it starting to play and
 * finishing. Past this bound the engine has lost track of it -- an overlay
 * closed mid-play, the engine restarted, a callback was never delivered -- and
 * no callback is coming to settle it. Counting it as in flight forever would
 * make the tile grow without bound, so the sweep marks it unconfirmed instead.
 *
 * One bound covers every unsettled status, `pending` included. The engine does
 * not hold an alert back waiting for an overlay (one with no running scene to
 * play on fails at once), and an engine that predates the playing callback
 * still sends its verdict within seconds of creating the alert. The mark is
 * not final either way: any later progress clears it, so an alert that does
 * wait longer returns to its real state the moment the engine reports it.
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
  /** Counts the engine's writes to the row; absent from older engines. */
  version?: number;
  createdAt: string;
  updatedAt: string;
}

/** Fields a snapshot is useless without: the row it describes and where it is. */
const SNAPSHOT_REQUIRED = ["id", "status"] as const;
/** Fields stored as given, or as "" when absent or unusable. */
const SNAPSHOT_DEFAULTED = ["payload", "updatedAt"] as const;
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
 * A callback's alert snapshot as read, with what was wrong with it.
 * `snapshot` is null when the value cannot describe an alert at all.
 */
export interface AlertSnapshotReading {
  snapshot: EngineAlertSnapshot | null;
  problems: string[];
}

/**
 * Read the alert snapshot a callback carries.
 *
 * Every alert callback goes through here. Only the snapshot's known fields are
 * copied, so a field a newer engine adds does not fail the mutation's
 * validator.
 *
 * Only `id` and `status` are required: without them there is no row to merge
 * into and no lifecycle to merge. Any other field that is absent, null or of
 * the wrong type is read as absent, and reported in `problems`, rather than
 * refusing the callback: a refused callback is lost, while one missing an
 * optional field still settles its alert. A missing `updatedAt` reads as "",
 * which orders the snapshot by the lifecycle rule alone, and a missing
 * `createdAt` takes `updatedAt`. A `version` that is not a positive integer is
 * left out, so the snapshot merges as one from an engine that sends none.
 */
export function readAlertSnapshot(value: unknown): AlertSnapshotReading {
  if (typeof value !== "object" || value === null) {
    return { snapshot: null, problems: ["the callback carries no alert object"] };
  }
  const source = value as Record<string, unknown>;
  const problems: string[] = [];
  const snapshot: Record<string, string | number> = {};
  for (const key of SNAPSHOT_REQUIRED) {
    const field = source[key];
    if (typeof field !== "string" || field === "") {
      problems.push(`${key} is ${describe(field)}`);
      continue;
    }
    snapshot[key] = field;
  }
  if (problems.length > 0) {
    return { snapshot: null, problems };
  }
  for (const key of SNAPSHOT_DEFAULTED) {
    const field = source[key];
    if (typeof field === "string") {
      snapshot[key] = field;
    } else {
      problems.push(`${key} is ${describe(field)}; read as ""`);
      snapshot[key] = "";
    }
  }
  const createdAt = source.createdAt;
  if (typeof createdAt === "string") {
    snapshot.createdAt = createdAt;
  } else {
    problems.push(`createdAt is ${describe(createdAt)}; read as updatedAt`);
    snapshot.createdAt = snapshot.updatedAt;
  }
  for (const key of SNAPSHOT_OPTIONAL) {
    const field = source[key];
    if (field === undefined) {
      continue;
    }
    if (typeof field !== "string") {
      problems.push(`${key} is ${describe(field)}; read as absent`);
      continue;
    }
    snapshot[key] = field;
  }
  const version = source.version;
  if (typeof version === "number" && Number.isSafeInteger(version) && version >= 1) {
    snapshot.version = version;
  } else if (version !== undefined) {
    problems.push(`version is ${describe(version)}; read as absent`);
  }
  return { snapshot: snapshot as unknown as EngineAlertSnapshot, problems };
}

function describe(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  return `malformed (${JSON.stringify(value) ?? typeof value})`;
}
