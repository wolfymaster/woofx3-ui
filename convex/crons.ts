import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Remove any pendingWorkflowOperations whose expiry has passed. These
// represent engine round-trips that never produced a webhook echo (engine
// crashed, network lost, etc.) and would otherwise leak indefinitely.
crons.interval(
  "sweep expired workflow pending operations",
  { minutes: 1 },
  internal.workflowInternal.sweepExpiredPending
);

export default crons;
