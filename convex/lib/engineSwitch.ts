import type { Doc } from "../_generated/dataModel";

// How a managed engine's provisioning status moves when billing stops and
// starts it, declared in one place. Requests come from billing's engine
// effects, settlements from the maintenance API's callbacks.

export type ProvisioningStatus = Doc<"engineProvisioning">["status"];

export type EngineSwitchMove =
  | "stopRequested"
  | "stopped"
  | "startRequested"
  | "started"
  | "foundRunning"
  | "foundFailed"
  | "refused";

/** Built engines a stop applies to. */
const RUNNING: readonly ProvisioningStatus[] = [
  "ready",
  "registering",
  "registered",
  "upgrading",
  "failed",
  "starting",
];

// A request is written before the maintenance API is called, so a call that
// fails leaves the row stopping or starting, and asking again applies from there.
export const ENGINE_SWITCH_TRANSITIONS: Record<
  EngineSwitchMove,
  { from: readonly ProvisioningStatus[]; to: ProvisioningStatus }
> = {
  stopRequested: { from: [...RUNNING, "stopping"], to: "stopping" },
  // The callback can overtake the row's own "stopping" write.
  stopped: { from: ["stopping", ...RUNNING], to: "stopped" },
  startRequested: { from: ["stopped", "starting"], to: "starting" },
  // A started engine keeps its database and registration, so it is registered again as it was.
  started: { from: ["starting", "stopped"], to: "registered" },
  // The maintenance API refused a start because the engine was not stopped,
  // and reports it running, or failed (which provisioning.retry resumes).
  foundRunning: { from: ["starting"], to: "registered" },
  foundFailed: { from: ["starting"], to: "failed" },
  // The maintenance API refused a stop or start that asking again can't fix.
  refused: { from: ["stopping", "starting"], to: "failed" },
};

/** The status `move` leads to from `current`, or null when the move doesn't apply from there. */
export function switchedStatus(current: ProvisioningStatus, move: EngineSwitchMove): ProvisioningStatus | null {
  const { from, to } = ENGINE_SWITCH_TRANSITIONS[move];
  return from.includes(current) ? to : null;
}
