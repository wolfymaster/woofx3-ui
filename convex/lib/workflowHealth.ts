/**
 * Whether the engine is running each stored workflow on its own.
 *
 * The engine refuses a workflow it cannot set up (bad parameters, a step naming
 * a missing action, a trigger that fails to register) and reports that as
 * health. Without it a refused workflow still lists as enabled and silently
 * never fires. Health reaches Convex three ways:
 *
 * - `workflow.health.snapshot`: every failing workflow as of `at`, sent when
 *   the engine starts and when its api reconnects. Authoritative: a workflow
 *   it does not list is ok.
 * - `workflow.health.changed`: one transition after that, ok-after-error
 *   included.
 * - `getWorkflowHealth()`: the same replace-all list, on request, to repair a
 *   missed delivery.
 *
 * The shapes below must match `WorkflowHealth`, `WorkflowHealthChangedEvent`
 * and `WorkflowHealthSnapshotEvent` in woofx3
 * shared/clients/typescript/api/webhooks.ts and `getWorkflowHealth` in
 * shared/clients/typescript/api/api.ts. They are declared here rather than
 * imported because every body is untrusted JSON, checked field by field before
 * anything is stored.
 *
 * `since` is when the engine entered a workflow's exact state, so a report
 * older than the stored one is a late delivery and loses.
 */

export const WORKFLOW_HEALTH_CHANGED_EVENT_TYPE = "workflow.health.changed";
export const WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE = "workflow.health.snapshot";

/** The engine RPC method; an engine that predates it answers "is not a function". */
export const GET_WORKFLOW_HEALTH_METHOD = "getWorkflowHealth";

/**
 * Longest reason kept. A reason is a list of validation messages meant for a
 * person to read; anything past this is noise and would only bloat the row.
 */
export const MAX_REASON_LENGTH = 2000;

export type WorkflowHealthStatus = "ok" | "error";

export interface WorkflowHealth {
  workflowId: string;
  status: WorkflowHealthStatus;
  reason?: string;
  /** ISO timestamp from the engine's clock. */
  since: string;
}

export interface ParsedWorkflowHealth {
  engineWorkflowId: string;
  status: WorkflowHealthStatus;
  reason: string | undefined;
  since: string;
  sinceMs: number;
}

export type WorkflowHealthParseResult = { ok: true; health: ParsedWorkflowHealth } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks one health entry, as the RPC lists it or the webhook carries it. */
export function parseWorkflowHealth(value: unknown): WorkflowHealthParseResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "health is not an object" };
  }
  if (typeof value.workflowId !== "string" || value.workflowId.length === 0) {
    return { ok: false, reason: "workflowId is missing" };
  }
  if (value.status !== "ok" && value.status !== "error") {
    return { ok: false, reason: "status is not ok or error" };
  }
  if (typeof value.since !== "string" || Number.isNaN(Date.parse(value.since))) {
    return { ok: false, reason: "since is not a timestamp" };
  }
  if (value.reason !== undefined && value.reason !== null && typeof value.reason !== "string") {
    return { ok: false, reason: "reason is not a string" };
  }
  const reason =
    typeof value.reason === "string" && value.reason.trim().length > 0
      ? value.reason.slice(0, MAX_REASON_LENGTH)
      : undefined;
  return {
    ok: true,
    health: {
      engineWorkflowId: value.workflowId,
      status: value.status,
      // A reason on an ok entry describes nothing that is wrong, so it is not kept.
      reason: value.status === "error" ? reason : undefined,
      since: value.since,
      sinceMs: Date.parse(value.since),
    },
  };
}

/** Checks a `workflow.health.changed` webhook body. */
export function parseWorkflowHealthChanged(data: unknown): WorkflowHealthParseResult {
  if (!isRecord(data)) {
    return { ok: false, reason: "event is not an object" };
  }
  if (data.type !== WORKFLOW_HEALTH_CHANGED_EVENT_TYPE) {
    return { ok: false, reason: `type is not ${WORKFLOW_HEALTH_CHANGED_EVENT_TYPE}` };
  }
  return parseWorkflowHealth(data);
}

export type WorkflowHealthListParseResult =
  | { ok: true; entries: ParsedWorkflowHealth[] }
  | { ok: false; reason: string };

/**
 * Checks a `getWorkflowHealth()` result. One malformed entry rejects the whole
 * list: a resync treats a workflow missing from the list as healthy, so
 * silently dropping an entry would clear an error the engine still reports.
 */
export function parseWorkflowHealthList(value: unknown): WorkflowHealthListParseResult {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "result is not an array" };
  }
  const entries: ParsedWorkflowHealth[] = [];
  for (let index = 0; index < value.length; index++) {
    const parsed = parseWorkflowHealth(value[index]);
    if (!parsed.ok) {
      return { ok: false, reason: `entry ${index}: ${parsed.reason}` };
    }
    entries.push(parsed.health);
  }
  return { ok: true, entries };
}

export interface WorkflowHealthSnapshotEvent {
  type: typeof WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE;
  /** Failing workflows only; every other workflow is ok. */
  workflows: WorkflowHealth[];
  /** ISO timestamp from the engine's clock: the moment the list describes. */
  at: string;
}

export interface ParsedWorkflowHealthSnapshot {
  entries: ParsedWorkflowHealth[];
  at: string;
  atMs: number;
}

export type WorkflowHealthSnapshotParseResult =
  | { ok: true; snapshot: ParsedWorkflowHealthSnapshot }
  | { ok: false; reason: string };

/** Checks a `workflow.health.snapshot` webhook body. */
export function parseWorkflowHealthSnapshot(data: unknown): WorkflowHealthSnapshotParseResult {
  if (!isRecord(data)) {
    return { ok: false, reason: "event is not an object" };
  }
  if (data.type !== WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE) {
    return { ok: false, reason: `type is not ${WORKFLOW_HEALTH_SNAPSHOT_EVENT_TYPE}` };
  }
  if (typeof data.at !== "string" || Number.isNaN(Date.parse(data.at))) {
    return { ok: false, reason: "at is not a timestamp" };
  }
  const list = parseWorkflowHealthList(data.workflows);
  if (!list.ok) {
    return { ok: false, reason: `workflows: ${list.reason}` };
  }
  return { ok: true, snapshot: { entries: list.entries, at: data.at, atMs: Date.parse(data.at) } };
}

/** The stored fields a merge decision reads. */
export interface StoredWorkflowHealth {
  status: WorkflowHealthStatus;
  reason?: string;
  sinceMs: number;
}

export type HealthWritePlan = "insert" | "replace" | "unchanged" | "stale";

/**
 * Whether an incoming report replaces the stored one. Webhooks can arrive out
 * of order and a resync can race one, so an older `since` never overwrites a
 * newer one. At an equal `since` the incoming report wins, since the engine
 * does not produce two different states at the same instant and a repeat of
 * the same state is reported as unchanged.
 */
export function planHealthWrite(
  existing: StoredWorkflowHealth | null,
  incoming: ParsedWorkflowHealth
): HealthWritePlan {
  if (existing === null) {
    return "insert";
  }
  if (incoming.sinceMs < existing.sinceMs) {
    return "stale";
  }
  if (
    incoming.sinceMs === existing.sinceMs &&
    incoming.status === existing.status &&
    (incoming.reason ?? "") === (existing.reason ?? "")
  ) {
    return "unchanged";
  }
  return "replace";
}

export interface StoredHealthRow extends StoredWorkflowHealth {
  engineWorkflowId: string;
  /** Convex clock, when the row was last written. */
  receivedAt: number;
}

export interface ReplaceAllPlan {
  /** Listed entries that replace or create a row. */
  writes: ParsedWorkflowHealth[];
  /** Stored errors the list no longer names, rewritten as ok. */
  clears: ParsedWorkflowHealth[];
}

/**
 * Merge an authoritative list into the stored rows: every workflow it does not
 * name as an error is ok. Listed entries still go through planHealthWrite, so a
 * `workflow.health.changed` newer than the list is not rolled back by it.
 *
 * `shouldClear` decides whether an unlisted error predates the list (and so is
 * really gone) or arrived after it was taken. A clear is written as ok with a
 * `since` past the error's own, so a late redelivery of that same error is
 * recognised as stale instead of bringing the badge back, while a later real
 * failure carries a later engine timestamp and still lands.
 */
function planReplaceAll(
  stored: readonly StoredHealthRow[],
  listed: readonly ParsedWorkflowHealth[],
  shouldClear: (row: StoredHealthRow) => boolean,
  clearSinceMs: (row: StoredHealthRow) => number
): ReplaceAllPlan {
  const storedById = new Map(stored.map((row) => [row.engineWorkflowId, row]));
  const listedIds = new Set<string>();
  const writes: ParsedWorkflowHealth[] = [];
  for (const entry of listed) {
    listedIds.add(entry.engineWorkflowId);
    const plan = planHealthWrite(storedById.get(entry.engineWorkflowId) ?? null, entry);
    if (plan === "insert" || plan === "replace") {
      writes.push(entry);
    }
  }
  const clears: ParsedWorkflowHealth[] = [];
  for (const row of stored) {
    if (row.status !== "error" || listedIds.has(row.engineWorkflowId) || !shouldClear(row)) {
      continue;
    }
    const sinceMs = clearSinceMs(row);
    clears.push({
      engineWorkflowId: row.engineWorkflowId,
      status: "ok",
      reason: undefined,
      since: new Date(sinceMs).toISOString(),
      sinceMs,
    });
  }
  return { writes, clears };
}

/**
 * Apply a `workflow.health.snapshot`. The engine sends one when it starts and
 * the api re-sends one when it reconnects; it names every failing workflow as
 * of `at`. Both `at` and a row's `since` are the engine's clock, so an error
 * that began after `at` is a transition the snapshot could not have seen and
 * is kept.
 */
export function planSnapshot(
  stored: readonly StoredHealthRow[],
  snapshot: ParsedWorkflowHealthSnapshot
): ReplaceAllPlan {
  return planReplaceAll(
    stored,
    snapshot.entries,
    (row) => row.sinceMs <= snapshot.atMs,
    (row) => Math.max(snapshot.atMs, row.sinceMs + 1)
  );
}

/**
 * Apply a `getWorkflowHealth()` result, which has the snapshot's replace-all
 * meaning but no `at`. An unlisted error is cleared only if it was written
 * before the fetch began: one written during the fetch may be a webhook the
 * result was taken too early to include. That comparison uses `receivedAt`,
 * because it and `fetchStartedAt` are both Convex's clock and the engine's may
 * differ.
 */
export function planResync(
  stored: readonly StoredHealthRow[],
  entries: readonly ParsedWorkflowHealth[],
  fetchStartedAt: number
): ReplaceAllPlan {
  return planReplaceAll(
    stored,
    entries,
    (row) => row.receivedAt < fetchStartedAt,
    (row) => row.sinceMs + 1
  );
}

/** What asked for a resync; each has its own minimum spacing. */
export type ResyncTrigger = "mount" | "reconnect";

/**
 * Minimum time between resyncs per instance. Webhooks already keep health
 * current; a resync only repairs a missed delivery, so opening the workflows
 * page repeatedly need not ask the engine each time. A reconnect is a stronger
 * hint that something was missed (the engine may have restarted), so it waits
 * less, but still enough that several open tabs reconnecting together make one
 * call.
 */
export const RESYNC_MIN_INTERVAL_MS: Record<ResyncTrigger, number> = {
  mount: 5 * 60_000,
  reconnect: 60_000,
};

export function shouldResync(lastAttemptAt: number | null, now: number, trigger: ResyncTrigger): boolean {
  if (lastAttemptAt === null) {
    return true;
  }
  return now - lastAttemptAt >= RESYNC_MIN_INTERVAL_MS[trigger];
}

/**
 * True when the engine does not have `method` at all, which is how an engine
 * older than the health RPC answers. capnweb reports a call to a missing
 * method as a TypeError "'<method>' is not a function.".
 */
export function isUnknownMethodError(err: unknown, method: string): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.includes(`'${method}' is not a function`);
}
