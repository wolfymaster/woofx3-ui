import { REPLAY_ORIGIN, TEST_RUN_ORIGIN, UNRECORDED_ORIGIN } from "@shared/manual-run-origin";
import { v } from "convex/values";

/** The origins a dashboard may give a run it starts (shared/manual-run-origin.ts). */
export const manualRunOrigin = v.union(
  v.literal(UNRECORDED_ORIGIN),
  v.literal(TEST_RUN_ORIGIN),
  v.literal(REPLAY_ORIGIN)
);
