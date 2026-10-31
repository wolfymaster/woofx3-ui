import type { EngineCapability, EngineCapabilityReport } from "@/engine/types";

/** What the browser knows about an instance's engine features; see useEngineCapabilities. */
export type EngineCapabilitiesState =
  | { status: "loading" }
  | { status: "ready"; report: EngineCapabilityReport }
  | { status: "error"; message: string };

/**
 * Whether a feature can be offered. `unknown` is an engine that could not be
 * asked; a feature gated on it stays hidden, like `unsupported`, but a page may
 * word it as "couldn't check" rather than "update your engine".
 */
export type CapabilitySupport = "checking" | "supported" | "unsupported" | "unknown";

/** Support for a feature that needs every id in `required`. A legacy engine supports none. */
export function capabilitySupport(
  state: EngineCapabilitiesState,
  required: readonly EngineCapability[]
): CapabilitySupport {
  if (required.length === 0) {
    throw new Error("capabilitySupport: no capability ids given");
  }
  if (state.status === "loading") {
    return "checking";
  }
  if (state.status === "error") {
    return "unknown";
  }
  const supported = required.every((id) => state.report.capabilities.includes(id));
  return supported ? "supported" : "unsupported";
}

/** The alert skip, clear and replay controls, with the result shapes the dashboard reads. */
export const ALERT_QUEUE_CONTROL_CAPABILITIES: readonly EngineCapability[] = ["alerts.queueControls"];

/** `{round(amount, 2)}` and the other function calls in a step's text. */
export const EXPRESSION_FUNCTION_CAPABILITIES: readonly EngineCapability[] = ["workflow.expressionFunctions"];

/** The alert library: alerts the engine stores as starting points for the alerts steps hold. */
export const ALERT_LIBRARY_CAPABILITIES: readonly EngineCapability[] = ["compositions.alerts"];

/** Stream session history plus leaderboards and viewer totals, which the supporters page reads together. */
export const SUPPORTER_CAPABILITIES: readonly EngineCapability[] = ["analytics.sessions", "analytics.aggregates"];

/** Per-minute viewer samples and a session's leaderboards, which a stream recap reads together. */
export const RECAP_ENGINE_CAPABILITIES: readonly EngineCapability[] = ["analytics.gauges", "analytics.aggregates"];

/** A session's events in time order, which the recap timeline draws as lanes. */
export const RECAP_EVENT_CAPABILITIES: readonly EngineCapability[] = ["analytics.sessionEvents"];

/**
 * The engine's event log and the streamer's selection of which event types it
 * logs and pushes, which the Events widget reads and edits together.
 */
export const EVENT_LOG_CAPABILITIES: readonly EngineCapability[] = ["events.log"];

export interface TestRunSupport {
  /** Sample trigger data and skipping conditions for one workflow. */
  options: CapabilitySupport;
  /** Steps with side effects describe what they would do. Sent as a test-run option. */
  dryRun: CapabilitySupport;
  /** Stop halts the run instead of only marking it stopped. */
  realCancel: CapabilitySupport;
}

/** Test-run features from the engine's capabilities. */
export function testRunSupport(state: EngineCapabilitiesState): TestRunSupport {
  const options = capabilitySupport(state, ["workflow.testRunOptions"]);
  return {
    options,
    dryRun: options === "supported" ? capabilitySupport(state, ["workflow.dryRun"]) : options,
    realCancel: capabilitySupport(state, ["workflow.realCancel"]),
  };
}

/**
 * Tells a reconnect apart from the first connect. An engine is updated by
 * restarting it, which drops the live session, so a session that comes back
 * after having dropped is when the engine's features may have changed.
 */
export function createReconnectDetector(): (connected: boolean) => boolean {
  let everConnected = false;
  let dropped = false;
  return (connected: boolean) => {
    if (!connected) {
      dropped = everConnected;
      return false;
    }
    const reconnect = everConnected && dropped;
    everConnected = true;
    dropped = false;
    return reconnect;
  };
}
