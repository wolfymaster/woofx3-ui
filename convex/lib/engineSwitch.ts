import type { Doc } from "../_generated/dataModel";

// How a managed engine's provisioning status moves when billing stops and
// starts it, declared in one place. Requests come from billing's engine
// effects, settlements from the maintenance API's callbacks.

export type ProvisioningStatus = Doc<"engineProvisioning">["status"];

export type EngineSwitchMove = "stopRequested" | "stopped" | "startRequested" | "started" | "foundRunning";

/** Built engines a stop applies to. */
const RUNNING: readonly ProvisioningStatus[] = [
  "ready",
  "registering",
  "registered",
  "upgrading",
  "failed",
  "starting",
];

export const ENGINE_SWITCH_TRANSITIONS: Record<
  EngineSwitchMove,
  { from: readonly ProvisioningStatus[]; to: ProvisioningStatus }
> = {
  stopRequested: { from: RUNNING, to: "stopping" },
  // The callback can overtake the row's own "stopping" write.
  stopped: { from: ["stopping", ...RUNNING], to: "stopped" },
  startRequested: { from: ["stopped"], to: "starting" },
  // A started engine keeps its database and registration, so it is registered again as it was.
  started: { from: ["starting", "stopped"], to: "registered" },
  // The maintenance API refused a start because the engine was not stopped.
  foundRunning: { from: ["stopped"], to: "registered" },
};

/** The status `move` leads to from `current`, or null when the move doesn't apply from there. */
export function switchedStatus(current: ProvisioningStatus, move: EngineSwitchMove): ProvisioningStatus | null {
  const { from, to } = ENGINE_SWITCH_TRANSITIONS[move];
  return from.includes(current) ? to : null;
}
