import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";

const crons = cronJobs();

// Every job here must cost the same on an idle deployment however many
// instances it holds: one function call per tick that reads an index for work
// that is actually due. Per-instance work is scheduled from that call only for
// instances that need it, never by visiting each instance in turn.

// Remove any pendingWorkflowOperations whose expiry has passed. These
// represent engine round-trips that never produced a webhook echo (engine
// crashed, network lost, etc.) and would otherwise leak indefinitely.
crons.interval(
  "sweep expired workflow pending operations",
  { hours: 24 },
  internal.workflowInternal.sweepExpiredPending
);

crons.interval("engine sync sweep", { minutes: ENGINE_SYNC_CONFIG.sweepIntervalMinutes }, internal.engineSync.sweep);

crons.interval("engine sync run history cleanup", { hours: 24 }, internal.engineSyncInternal.cleanupOldRuns);

crons.interval("engine event log cleanup", { hours: 24 }, internal.engineEventLog.cleanupOld);

// Maintenance callback ids exist only to reject a redelivery of an event already
// applied; once the sender has stopped retrying they are dead weight.
crons.interval("maintenance callback id cleanup", { hours: 24 }, internal.provisioningInternal.cleanupOldEvents);

// Catches a live instance whose STREAM_OFFLINE webhook never arrived (EventSub
// lapses, engine restarts), which would otherwise show live indefinitely.
crons.interval("stream live state sweep", { minutes: 10 }, internal.streamStatus.sweepLiveState);

// Re-arms a shoutout queue whose processor run went missing — a run that died
// before it could reschedule itself. A run is otherwise only ever scheduled by
// an enqueue or by the run before it, so without this a queue with work in it
// sits idle and nothing reports it.
crons.interval("shoutout queue sweep", { minutes: 10 }, internal.shoutouts.sweepStalledQueues);

// Pairing attempts live ten minutes; this deletes them an hour after expiry.
crons.interval("companion pairing cleanup", { hours: 1 }, internal.companionPairing.cleanupExpired);

// Re-sends each bridging instance's relay configuration, repairing an engine
// that lost it. Reads only enabled companion endpoints.
crons.interval("companion relay resync", { minutes: 15 }, internal.companionRelay.resyncBridgedInstances, {});

export default crons;
