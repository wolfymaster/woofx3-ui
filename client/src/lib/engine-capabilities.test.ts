import { describe, expect, test } from "bun:test";
import { ENGINE_CAPABILITY_IDS, type EngineCapability } from "@convex/lib/engineCapabilities";
import {
  ALERT_QUEUE_CONTROL_CAPABILITIES,
  capabilitySupport,
  createReconnectDetector,
  type EngineCapabilitiesState,
  EXPRESSION_FUNCTION_CAPABILITIES,
  testRunSupport,
} from "./engine-capabilities";

function ready(...capabilities: EngineCapability[]): EngineCapabilitiesState {
  return { status: "ready", report: { legacy: false, capabilities } };
}

const LEGACY: EngineCapabilitiesState = { status: "ready", report: { legacy: true, capabilities: [] } };
const LOADING: EngineCapabilitiesState = { status: "loading" };
const FAILED: EngineCapabilitiesState = { status: "error", message: "fetch failed" };

describe("capabilitySupport", () => {
  test("needs every id", () => {
    const state = ready("analytics.sessions", "analytics.aggregates");
    expect(capabilitySupport(state, ["analytics.sessions", "analytics.aggregates"])).toBe("supported");
    expect(capabilitySupport(state, ["analytics.sessions", "analytics.gauges"])).toBe("unsupported");
  });

  test("alert queue controls need alerts.queueControls", () => {
    expect(capabilitySupport(ready("alerts.queueControls"), ALERT_QUEUE_CONTROL_CAPABILITIES)).toBe("supported");
    expect(capabilitySupport(ready("obs.control"), ALERT_QUEUE_CONTROL_CAPABILITIES)).toBe("unsupported");
  });

  test("a legacy engine supports nothing", () => {
    expect(capabilitySupport(LEGACY, ["config.bundles"])).toBe("unsupported");
  });

  test("reports checking while loading and unknown when the engine could not be asked", () => {
    expect(capabilitySupport(LOADING, ["config.bundles"])).toBe("checking");
    expect(capabilitySupport(FAILED, ["config.bundles"])).toBe("unknown");
  });

  test("refuses an empty requirement", () => {
    expect(() => capabilitySupport(ready(), [])).toThrow();
  });
});

describe("testRunSupport", () => {
  test("reads each feature from its own id", () => {
    expect(testRunSupport(ready("workflow.testRunOptions", "workflow.realCancel"))).toEqual({
      options: "supported",
      dryRun: "unsupported",
      realCancel: "supported",
    });
    expect(testRunSupport(ready("workflow.dryRun"))).toEqual({
      options: "unsupported",
      dryRun: "unsupported",
      realCancel: "unsupported",
    });
  });

  test("a legacy engine supports none of them", () => {
    expect(testRunSupport(LEGACY)).toEqual({
      options: "unsupported",
      dryRun: "unsupported",
      realCancel: "unsupported",
    });
  });

  test("follows the capabilities request while it is out or failed", () => {
    expect(testRunSupport(LOADING).options).toBe("checking");
    expect(testRunSupport(FAILED).realCancel).toBe("unknown");
  });
});

describe("createReconnectDetector", () => {
  test("the first connect is not a reconnect; coming back after a drop is", () => {
    const isReconnect = createReconnectDetector();
    expect(isReconnect(false)).toBe(false);
    expect(isReconnect(true)).toBe(false);
    expect(isReconnect(true)).toBe(false);
    expect(isReconnect(false)).toBe(false);
    expect(isReconnect(true)).toBe(true);
    expect(isReconnect(true)).toBe(false);
  });
});

// Convex drops any id outside its list, so a gate on a missing id never opens.
describe("the ids Convex lets through", () => {
  test("include what expression functions are gated on", () => {
    for (const id of EXPRESSION_FUNCTION_CAPABILITIES) {
      expect(ENGINE_CAPABILITY_IDS).toContain(id);
    }
  });
});
