import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";

const crons = cronJobs();

// Remove any pendingWorkflowOperations whose expiry has passed. These
// represent engine round-trips that never produced a webhook echo (engine
// crashed, network lost, etc.) and would otherwise leak indefinitely.
crons.interval(
  "sweep expired workflow pending operations",
  { minutes: 1 },
  internal.workflowInternal.sweepExpiredPending
);

crons.interval("engine sync sweep", { minutes: ENGINE_SYNC_CONFIG.sweepIntervalMinutes }, internal.engineSync.sweep);

crons.interval("engine sync run history cleanup", { hours: 24 }, internal.engineSyncInternal.cleanupOldRuns);

crons.interval("engine event log cleanup", { hours: 24 }, internal.engineEventLog.cleanupOld);

// Self-heals instanceLiveState if the engine's STREAM_ONLINE/OFFLINE webhook
// stops delivering (EventSub lapses, engine restarts) — runs regardless of
// whether anyone has the dashboard open.
crons.interval("stream live state sweep", { minutes: 2 }, internal.streamStatus.sweepLiveState);

export default crons;
