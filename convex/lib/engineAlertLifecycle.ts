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
 * How far along an alert a status is. Orders snapshots that carry no version;
 * see `mergeLifecycle`.
 *
 * Callbacks are projected from two outbox subjects (`created` and `updated`)
 * and retried independently, so `alert.recorded` can land after the alert has
 * already finished. Ranking keeps that late snapshot from reviving a settled
 * alert. Verdicts share a stage. `replayed` sits above them: the operator
 * superseded the row, and a straggling verdict for the original play does not
 * undo that.
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

/** One snapshot of an alert's lifecycle, as far as ordering it goes. */
export interface AlertLifecyclePoint {
  status: EngineAlertStatus;
  /** The engine row's `version`, when the snapshot carries one. */
  engineVersion?: number;
  /** The engine row's `updated_at`, an RFC 3339 string, when it carries one that parses. */
  engineUpdatedAt?: string;
}

/**
 * What merging a callback's lifecycle into a row does:
 *
 * - `apply`: store the snapshot's lifecycle. `progressed` is whether the alert
 *   moved, which is every applied snapshot but one that only gives the row the
 *   version of the write it already holds. Counting that as progress would
 *   keep an alert the engine lost track of in flight indefinitely.
 * - `keep`: the row keeps its lifecycle, because the snapshot is the write it
 *   holds, an earlier one, or one that cannot be ordered after it. Expected
 *   under retries; nothing to report.
 * - `diverged`: the row keeps its lifecycle although the snapshot carries the
 *   version it holds with a different status. The engine never sends one, so
 *   the caller logs it.
 */
export type LifecycleMerge =
  | { kind: "apply"; progressed: boolean }
  | { kind: "keep" }
  | { kind: "diverged"; reason: string };

const KEEP: LifecycleMerge = { kind: "keep" };
const PROGRESS: LifecycleMerge = { kind: "apply", progressed: true };

/**
 * Whether a callback's `incoming` lifecycle replaces the row's `current` one.
 *
 * Callbacks are projected from two outbox subjects and retried independently,
 * so they arrive late, twice, and out of order.
 *
 * When both carry a version, the higher version wins: the engine increments it
 * with every write it publishes, and it alone decides which transitions apply,
 * publishing only those. An equal version is the same write delivered again,
 * and a lower one a write the row has moved past.
 *
 * Otherwise see `mergeWithoutVersions`.
 */
export function mergeLifecycle(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): LifecycleMerge {
  if (current.engineVersion === undefined || incoming.engineVersion === undefined) {
    return mergeWithoutVersions(current, incoming);
  }
  if (incoming.engineVersion > current.engineVersion) {
    return PROGRESS;
  }
  if (incoming.engineVersion === current.engineVersion && incoming.status !== current.status) {
    return {
      kind: "diverged",
      reason: `version ${incoming.engineVersion} arrived as ${incoming.status} but is held as ${current.status}`,
    };
  }
  return KEEP;
}

/**
 * Order two snapshots when at least one carries no version, by lifecycle stage
 * and then by `updatedAt`.
 *
 * A snapshot never moves the row to an earlier stage, nor applies when its
 * `updatedAt` is older than the row's. A later stage applies otherwise. Within
 * one stage, a newer `updatedAt` wins, so a later verdict can replace an
 * earlier one; when either side has no usable `updatedAt` the row keeps what
 * it holds, so a verdict is never replaced by one that cannot be ordered after
 * it.
 *
 * One exception: a versioned snapshot reaching an unversioned row that has no
 * usable `updatedAt` applies within the row's stage too. Nothing could ever be
 * ordered after such a row, so without it the row would refuse every
 * same-stage correction and never adopt a version. The versioned snapshot is
 * the one to trust: the engine published it only after its own forward-only
 * rule accepted the write, and once the row holds its version every later
 * snapshot is ordered by version. The trade-off is that a straggling versioned
 * verdict can replace an unversioned one written after it, which needs an
 * engine upgrade between the two writes of one alert.
 *
 * A row that holds a version takes an unversioned snapshot only when both
 * carry a usable `updatedAt` and the snapshot's is newer, and storing it drops
 * the version, which no longer describes the lifecycle the row holds. A
 * snapshot that cannot be ordered after the row therefore never discards its
 * version.
 */
function mergeWithoutVersions(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): LifecycleMerge {
  const currentStage = stageOf(current.status);
  const incomingStage = stageOf(incoming.status);
  if (incomingStage < currentStage) {
    return KEEP;
  }
  const order = compareUpdatedAt(current, incoming);
  if (current.engineVersion !== undefined) {
    return order === 1 ? PROGRESS : KEEP;
  }
  if (order === -1) {
    return KEEP;
  }
  if (incomingStage > currentStage || order === 1) {
    return PROGRESS;
  }
  if (incoming.engineVersion === undefined) {
    return KEEP;
  }
  if (order === 0 && incoming.status === current.status) {
    return { kind: "apply", progressed: false };
  }
  if (order === null && parseUpdatedAt(current) === null) {
    return incoming.status === current.status ? { kind: "apply", progressed: false } : PROGRESS;
  }
  return KEEP;
}

/**
 * Whether `incoming` was written after `current` (1), before it (-1), at the
 * same instant (0), or cannot be ordered against it (null), by `updatedAt` at
 * full precision.
 */
function compareUpdatedAt(current: AlertLifecyclePoint, incoming: AlertLifecyclePoint): -1 | 0 | 1 | null {
  const currentAt = parseUpdatedAt(current);
  const incomingAt = parseUpdatedAt(incoming);
  if (currentAt === null || incomingAt === null) {
    return null;
  }
  if (incomingAt > currentAt) {
    return 1;
  }
  if (incomingAt < currentAt) {
    return -1;
  }
  return 0;
}

function parseUpdatedAt(point: AlertLifecyclePoint): bigint | null {
  return point.engineUpdatedAt === undefined ? null : parseEngineTimestamp(point.engineUpdatedAt);
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

/**
 * The engine's `AlertSnapshot`, as `readAlertSnapshot` reads it: only the
 * fields a callback carried in a usable form.
 */
export interface EngineAlertSnapshot {
  id: string;
  status: string;
  payload?: string;
  workflowId?: string;
  sourceEventId?: string;
  envelopeId?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
  error?: string;
  /** Counts the engine's writes to the row. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Fields the callback carried in a form that could not be read. */
  unreadable?: string[];
}

/** Fields a snapshot is useless without: the row it describes and where it is. */
const SNAPSHOT_REQUIRED = ["id", "status"] as const;
const SNAPSHOT_TEXT = ["payload", "workflowId", "sourceEventId", "envelopeId", "error"] as const;
const SNAPSHOT_TIMESTAMPS = ["dispatchedAt", "playedAt", "completedAt", "createdAt", "updatedAt"] as const;

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
 * into and no lifecycle to merge. Any other field that is null, of the wrong
 * type, or a timestamp that does not parse is left out, named in `unreadable`
 * and reported in `problems`, rather than refusing the callback: a refused
 * callback is lost, while one missing an optional field still settles its
 * alert.
 *
 * `error: null` is the exception: it says the alert has no error, exactly as
 * leaving `error` out does, so it reads as absent and clears a stored error.
 *
 * `version` is a positive safe integer, as a JSON number or as its decimal
 * string, the form protobuf's JSON mapping gives an int64. Any other value is
 * unreadable.
 *
 * A problem names the field and the type of its value, never the value: a
 * snapshot carries the alert's payload and error text, which can hold viewer
 * names and chat messages, and problems are logged.
 */
export function readAlertSnapshot(value: unknown): AlertSnapshotReading {
  if (typeof value !== "object" || value === null) {
    return { snapshot: null, problems: ["the callback carries no alert object"] };
  }
  const source = value as Record<string, unknown>;
  const problems: string[] = [];
  const snapshot: Record<string, string | number | string[]> = {};
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
  const unreadable: string[] = [];
  const skip = (key: string, field: unknown) => {
    unreadable.push(key);
    problems.push(`${key} is ${describe(field)}; read as absent`);
  };
  for (const key of SNAPSHOT_TEXT) {
    const field = source[key];
    if (field === undefined || (key === "error" && field === null)) {
      continue;
    }
    if (typeof field !== "string") {
      skip(key, field);
      continue;
    }
    snapshot[key] = field;
  }
  for (const key of SNAPSHOT_TIMESTAMPS) {
    const field = source[key];
    if (field === undefined) {
      continue;
    }
    if (typeof field !== "string" || parseEngineTimestamp(field) === null) {
      skip(key, field);
      continue;
    }
    snapshot[key] = field;
  }
  const version = readVersion(source.version);
  if (version !== null) {
    snapshot.version = version;
  } else if (source.version !== undefined) {
    skip("version", source.version);
  }
  if (unreadable.length > 0) {
    snapshot.unreadable = unreadable;
  }
  return { snapshot: snapshot as unknown as EngineAlertSnapshot, problems };
}

const DECIMAL_INTEGER = /^[1-9][0-9]*$/;

/** A snapshot's `version` as a positive safe integer, or null when it is not one. */
function readVersion(value: unknown): number | null {
  const parsed = typeof value === "string" && DECIMAL_INTEGER.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function describe(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "malformed (null)";
  }
  return `malformed (${Array.isArray(value) ? "array" : typeof value})`;
}

/** The fields of an `engineAlerts` row that mirror the engine's alert. */
export interface EngineAlertMirror {
  status: EngineAlertStatus;
  engineStatus?: string;
  payload?: string;
  workflowId?: string;
  sourceEventId?: string;
  envelopeId?: string;
  dispatchedAt?: string;
  playedAt?: string;
  completedAt?: string;
  error?: string;
  engineVersion?: number;
  engineCreatedAt?: string;
  engineUpdatedAt?: string;
}

/** The mirror of an alert first heard of through `snapshot`. */
export function mirrorOf(snapshot: EngineAlertSnapshot): EngineAlertMirror {
  const status = normaliseStatus(snapshot.status);
  return {
    status,
    engineStatus: status === "unknown" ? snapshot.status : undefined,
    payload: snapshot.payload || undefined,
    workflowId: snapshot.workflowId || undefined,
    sourceEventId: snapshot.sourceEventId || undefined,
    envelopeId: snapshot.envelopeId || undefined,
    dispatchedAt: snapshot.dispatchedAt,
    playedAt: snapshot.playedAt,
    completedAt: snapshot.completedAt,
    error: snapshot.error || undefined,
    engineVersion: snapshot.version,
    engineCreatedAt: snapshot.createdAt,
    engineUpdatedAt: snapshot.updatedAt,
  };
}

/**
 * How a row changes for a callback's snapshot: the fields to patch, whether
 * the alert progressed, and a divergence to log.
 */
export interface MirrorUpdate {
  patch: Partial<EngineAlertMirror>;
  progressed: boolean;
  divergence?: string;
}

/**
 * The update a callback's `snapshot` makes to a row holding `row`.
 *
 * Two kinds of field, merged differently:
 *
 * - What the engine's row was created with (payload, workflow, source event,
 *   envelope, `createdAt`) never changes, so any snapshot fills it in where the
 *   row lacks it, even one whose lifecycle is older than the row's.
 * - The lifecycle is replaced as a whole when `mergeLifecycle` applies the
 *   snapshot. The engine never unsets a lifecycle timestamp, so one the
 *   snapshot lacks keeps the row's. `error` is different: the engine leaves it
 *   out when a verdict cleared it, so an absent error clears the row's; one
 *   the snapshot carried unreadably keeps it.
 * - `updatedAt` is what later snapshots without a version are ordered against,
 *   so it must be the time of the lifecycle the row holds. It is taken from the
 *   applied snapshot, and cleared when that snapshot has none: the row's older
 *   time no longer describes its lifecycle, and a straggler newer than that
 *   time could otherwise overwrite it.
 *
 * No field is ever overwritten with a value the snapshot did not carry in a
 * usable form.
 */
export function updateMirror(row: EngineAlertMirror, snapshot: EngineAlertSnapshot): MirrorUpdate {
  const patch: Partial<EngineAlertMirror> = {};
  if (!row.payload && snapshot.payload) {
    patch.payload = snapshot.payload;
  }
  if (!row.workflowId && snapshot.workflowId) {
    patch.workflowId = snapshot.workflowId;
  }
  if (!row.sourceEventId && snapshot.sourceEventId) {
    patch.sourceEventId = snapshot.sourceEventId;
  }
  if (!row.envelopeId && snapshot.envelopeId) {
    patch.envelopeId = snapshot.envelopeId;
  }
  if (!row.engineCreatedAt && snapshot.createdAt) {
    patch.engineCreatedAt = snapshot.createdAt;
  }

  const status = normaliseStatus(snapshot.status);
  const merge = mergeLifecycle(row, {
    status,
    engineVersion: snapshot.version,
    engineUpdatedAt: snapshot.updatedAt,
  });
  if (merge.kind === "diverged") {
    return { patch, progressed: false, divergence: merge.reason };
  }
  if (merge.kind === "keep") {
    return { patch, progressed: false };
  }
  const errorUnreadable = snapshot.unreadable?.includes("error") ?? false;
  Object.assign(patch, {
    status,
    engineStatus: status === "unknown" ? snapshot.status : undefined,
    engineVersion: snapshot.version,
    engineUpdatedAt: snapshot.updatedAt,
    dispatchedAt: snapshot.dispatchedAt ?? row.dispatchedAt,
    playedAt: snapshot.playedAt ?? row.playedAt,
    completedAt: snapshot.completedAt ?? row.completedAt,
    error: errorUnreadable ? row.error : snapshot.error || undefined,
  } satisfies Partial<EngineAlertMirror>);
  return { patch, progressed: merge.progressed };
}
