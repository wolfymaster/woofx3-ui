import type { ObsStatus } from "@convex/lib/engineObsStatus";

/** Must match the OBS module's manifest id in woofx3-modules. */
export const OBS_MODULE_ID = "woofx3_obs";

export type ObsStatusTone = "ok" | "pending" | "problem" | "unknown";

export interface ObsStatusDescription {
  tone: ObsStatusTone;
  text: string;
}

/** What the engine's OBS connection state means for the streamer, in one line. */
export function describeObsStatus(status: ObsStatus): ObsStatusDescription {
  const where = status.address ? ` at ${status.address}` : "";
  if (status.state === "connected") {
    // Through the bridge, `address` is the relay's hostname, which says nothing useful to the streamer.
    if (status.route === "companion") {
      return { tone: "ok", text: "Connected to OBS through the companion" };
    }
    return { tone: "ok", text: `Connected to OBS${where}` };
  }
  if (status.state === "unanswered") {
    return { tone: "unknown", text: "Can't check OBS right now: the engine did not answer" };
  }
  if (status.state === "stopped") {
    return { tone: "unknown", text: "The engine is not connecting to OBS" };
  }
  if (status.failure === "authentication") {
    return {
      tone: "problem",
      text: "OBS refused the password. Copy it from OBS under Tools → WebSocket Server Settings → Show Connect Info.",
    };
  }
  if (status.failure === "relay") {
    return {
      tone: "problem",
      text: "Your companion isn't connected, so the engine can't reach OBS. Open the woofx3 companion on your PC.",
    };
  }
  if (status.failure === "unreachable") {
    return {
      tone: "problem",
      text: `Can't reach OBS${where}. Check that OBS is open and its WebSocket server is on.`,
    };
  }
  return { tone: "pending", text: `Connecting to OBS${where}…` };
}
