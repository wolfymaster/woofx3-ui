import { REPLAY_ORIGIN, TEST_RUN_ORIGIN, UNRECORDED_ORIGIN } from "@convex/lib/manualRunOrigin";
import { parseEngineTime, presentPayload, toneFor } from "@/lib/workflow-run-timeline";

/**
 * How a row in a workflow's Runs panel reads and what it offers. Logic only,
 * so it can be tested; see workflow-runs-panel.tsx for the markup.
 */

/** The fields of a `workflowRuns` row the panel reads. */
export interface RunRow {
  status: string;
  triggeredBy?: string;
  triggerEvent?: string;
  startedAt?: string;
  completedAt?: string;
}

/** What started the run, in words. An unknown origin shows as the engine sent it. */
export function runOriginLabel(triggeredBy: string | undefined): string {
  switch (triggeredBy) {
    case TEST_RUN_ORIGIN:
      return "Test run";
    case REPLAY_ORIGIN:
      return "Replay";
    case UNRECORDED_ORIGIN:
      return "Dashboard";
    case undefined:
    case "":
      return "Event";
    default:
      return triggeredBy;
  }
}

/** Whether the run has yet to settle, and so can still be cancelled. */
export function isActiveRun(run: RunRow): boolean {
  return toneFor(run.status) === "running";
}

/**
 * Whether the run can be replayed: it has settled, and its trigger event was
 * recorded -- a replay re-feeds that event, and without it has nothing to run.
 */
export function canReplayRun(run: RunRow): boolean {
  return !isActiveRun(run) && presentPayload(run.triggerEvent) !== null;
}

/**
 * How long the run took, or has taken so far while it is still going.
 * Undefined when a timestamp it needs is missing or unreadable.
 */
export function runDurationMs(run: RunRow, now: number): number | undefined {
  const started = parseEngineTime(run.startedAt);
  if (started === undefined) {
    return undefined;
  }
  const ended = isActiveRun(run) ? now : parseEngineTime(run.completedAt);
  if (ended === undefined || ended < started) {
    return undefined;
  }
  return ended - started;
}
