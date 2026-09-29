import { v } from "convex/values";

/**
 * The `triggeredBy` a run started by hand from the dashboard carries.
 *
 * The engine keeps no history of a run whose origin is exactly `"dashboard"`
 * (must match `dashboardOrigin` in woofx3 `workflow/run_recorder.go`): the
 * person who fired it is watching it live, and a row for every hand-fire would
 * bury the runs nobody saw. A test run or a replay started from a workflow's
 * Runs panel is different -- its trace is the point, and the trace is built from
 * the recorded rows -- so those carry an origin of their own, which the engine
 * records like any other run.
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
