import { v } from "convex/values";

/**
 * The `triggeredBy` a run started by hand from the dashboard carries.
 *
 * The engine keeps no history of a run whose origin is exactly `"dashboard"`
 * (must match `dashboardOrigin` in woofx3 `workflow/run_recorder.go`). Nothing
 * the dashboard fires uses it any more: a test event or a replay plays an
 * alert, and the alert feed links each alert to the run that fired it, so a
 * run nobody recorded leaves that link pointing at nothing. Test events and
 * replays carry an origin of their own, which the engine records like any
 * other run and the Runs panel labels as what it was.
 */
export const UNRECORDED_ORIGIN = "dashboard";
export const TEST_RUN_ORIGIN = "test";
export const REPLAY_ORIGIN = "replay";

export type ManualRunOrigin = typeof UNRECORDED_ORIGIN | typeof TEST_RUN_ORIGIN | typeof REPLAY_ORIGIN;

export const manualRunOrigin = v.union(
  v.literal(UNRECORDED_ORIGIN),
  v.literal(TEST_RUN_ORIGIN),
  v.literal(REPLAY_ORIGIN)
);

/** Whether the engine writes a run with this origin to its history. */
export function isRecordedOrigin(origin: ManualRunOrigin): boolean {
  return origin !== UNRECORDED_ORIGIN;
}
