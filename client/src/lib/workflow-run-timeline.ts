import { type AlertFailureCopy, describeAlertFailure } from "./alert-failure";

/**
 * The shape of a recorded workflow run as the run timeline draws it.
 *
 * Kept apart from the components because every decision here -- what a status
 * means, which step broke the run, whether a payload is worth offering -- is
 * logic, and this repo tests logic under `lib/` rather than rendering.
 */

/** The four visual states a run or step can be in. */
export type Tone = "running" | "success" | "failure" | "neutral";

/** The fields of a `workflowRuns` row the timeline reads. */
export interface RunRecord {
  engineRunId: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  triggeredBy?: string;
  triggerEvent?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** The fields of a `workflowRunSteps` row the timeline reads. */
export interface StepRecord {
  taskId: string;
  name?: string;
  status: string;
  attempt: number;
  stepIndex: number;
  inputs?: string;
  outputs?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface TimelineTrigger {
  type: string;
  source?: string;
  platform?: string;
  occurredAt?: string;
  /** The event verbatim, for the payload viewer. */
  payload: string;
}

export interface TimelineStep {
  /** Stable React key: one entry per attempt. */
  key: string;
  taskId: string;
  label: string;
  status: string;
  tone: Tone;
  stepIndex: number;
  attempt: number;
  durationMs?: number;
  error?: string;
  /** Readable copy for a failure the mapping recognises, else null. */
  failure: AlertFailureCopy | null;
  inputs: string | null;
  outputs: string | null;
}

export interface Timeline {
  trigger: TimelineTrigger | null;
  steps: TimelineStep[];
  /** The step that ended the run, when it ended by failing. */
  failedStep: TimelineStep | null;
  tone: Tone;
  durationMs?: number;
}

/**
 * Map a run or step status to how it should look.
 *
 * Unknown statuses read as neutral rather than as a failure or success: the
 * engine's status set grows, and guessing a new one's meaning would put a
 * green tick or a red cross on something neither describes.
 */
export function toneFor(status: string): Tone {
  switch (status) {
    case "running":
    case "waiting":
    case "pending":
      return "running";
    case "completed":
    case "success":
      return "success";
    case "failed":
    case "cancelled":
      return "failure";
    default:
      return "neutral";
  }
}

/**
 * A payload worth offering to view, or null.
 *
 * `{}` is what the db proxy stores when a step had nothing to record, so it is
 * treated as empty -- a "View JSON" button that opens an empty object is noise.
 */
export function presentPayload(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "{}" || trimmed === "null") {
    return null;
  }
  return raw;
}

/**
 * The trigger event a run started from, or null when none was stored.
 *
 * Tolerant of a malformed payload: the stored string is still offered for
 * viewing even when its fields cannot be read, because that is exactly the
 * case where someone needs to see what arrived.
 */
export function parseTrigger(raw: string | undefined): TimelineTrigger | null {
  const payload = presentPayload(raw);
  if (payload === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") {
      return { type: "unknown event", payload };
    }
    const event = parsed as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
    return {
      type: str(event.type) ?? "unknown event",
      source: str(event.source),
      platform: str(event.platform),
      occurredAt: str(event.time),
      payload,
    };
  } catch {
    return { type: "unreadable event", payload };
  }
}

function msBetween(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** Assemble everything the timeline draws for one run. */
export function buildTimeline(run: RunRecord, steps: StepRecord[]): Timeline {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex || a.attempt - b.attempt);

  const timelineSteps: TimelineStep[] = ordered.map((step) => ({
    key: `${step.taskId}:${step.attempt}`,
    taskId: step.taskId,
    label: step.name && step.name !== step.taskId ? step.name : step.taskId,
    status: step.status,
    tone: toneFor(step.status),
    stepIndex: step.stepIndex,
    attempt: step.attempt,
    durationMs: step.durationMs ?? msBetween(step.startedAt, step.completedAt),
    error: step.error,
    failure: step.error ? describeAlertFailure(step.error) : null,
    inputs: presentPayload(step.inputs),
    outputs: presentPayload(step.outputs),
  }));

  // The last failed attempt, not the first: a retried step that failed and
  // then failed again ended the run on its final attempt.
  const failedStep = [...timelineSteps].reverse().find((step) => step.tone === "failure") ?? null;

  return {
    trigger: parseTrigger(run.triggerEvent),
    steps: timelineSteps,
    failedStep,
    tone: toneFor(run.status),
    durationMs: msBetween(run.startedAt, run.completedAt),
  };
}

/** A duration short enough to read at a glance. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) {
    return "";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
