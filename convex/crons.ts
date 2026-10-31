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

// Alerts carry viewer names and messages; past the engine's detail retention
// nothing reads them.
crons.interval("engine alert cleanup", { hours: 24 }, internal.engineAlerts.cleanupOld, {});

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

// Marks alerts the engine lost track of as unconfirmed, so the dashboard stops
// counting them in flight. Reads only unsettled rows already past the bound;
// at this cadence an alert is marked within five minutes of crossing it.
crons.interval("engine alert staleness sweep", { minutes: 5 }, internal.engineAlerts.markStaleAlerts, {});

// Releases hosted storage reservations whose upload action died before
// releasing them, and deletes released ones no limit check can still need.
crons.interval("hosted storage reservation sweep", { minutes: 5 }, internal.hostedStorage.sweep, {});

// Picks up submission queues whose delivery is due: backoff retries, and any
// pass that died before finishing. Reads only queues already due.
crons.interval("page submission delivery sweep", { minutes: 1 }, internal.userPageForms.sweepDueQueues, {});

// Deletes delivered submissions past their retention. Pending and failed ones are kept.
crons.interval("page submission prune", { hours: 6 }, internal.userPageForms.pruneDelivered, {});

export default crons;
