import type { EngineCapability, EngineCapabilityReport } from "@convex/lib/engineCapabilities";
import type { OptionsSupport } from "@convex/lib/engineTestRun";

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

/**
 * Support for a feature that needs every id in `required` (`mode: "all"`) or
 * any one of them (`mode: "any"`). A legacy engine supports none.
 */
export function capabilitySupport(
  state: EngineCapabilitiesState,
  required: readonly EngineCapability[],
  mode: "all" | "any" = "all"
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
  const has = (id: EngineCapability) => state.report.capabilities.includes(id);
  const supported = mode === "all" ? required.every(has) : required.some(has);
  return supported ? "supported" : "unsupported";
}

/**
 * The alert skip and clear controls. `alerts.skipClear` is the id the engine
 * declares for `skipCurrentAlert` and `clearAlertQueue`; `alerts.queueControls`
 * names the same controls and is accepted so either spelling of the engine
 * contract turns them on.
 */
export const ALERT_QUEUE_CONTROL_CAPABILITIES: readonly EngineCapability[] = [
  "alerts.skipClear",
  "alerts.queueControls",
];

/** Stream session history plus leaderboards and viewer totals, which the supporters page reads together. */
export const SUPPORTER_CAPABILITIES: readonly EngineCapability[] = ["analytics.sessions", "analytics.aggregates"];

/** Per-minute viewer samples and a session's leaderboards, which a stream recap reads together. */
export const RECAP_ENGINE_CAPABILITIES: readonly EngineCapability[] = ["analytics.gauges", "analytics.aggregates"];

type TestRunState = OptionsSupport | "checking";

export interface TestRunSupport {
  /** Sample trigger data and skipping conditions for one workflow. */
  options: TestRunState;
  /** Steps with side effects describe what they would do. Sent as a test-run option. */
  dryRun: TestRunState;
  /** Stop halts the run instead of only marking it stopped. */
  realCancel: TestRunState;
}

/**
 * Test-run features from the engine's capabilities. An engine that predates
 * capabilities may still have them, having shipped between the two, so for
 * that engine the answer comes from `legacyProbe` (see
 * `workflowActions.testRunCapabilities`); the three arrived in one engine
 * update, so one probe answers all of them.
 */
export function testRunSupport(state: EngineCapabilitiesState, legacyProbe: TestRunState): TestRunSupport {
  if (state.status === "ready" && state.report.legacy) {
    return { options: legacyProbe, dryRun: legacyProbe, realCancel: legacyProbe };
  }
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
