import { describe, expect, test } from "bun:test";
import type { EngineCapability } from "@convex/lib/engineCapabilities";
import {
  ALERT_QUEUE_CONTROL_CAPABILITIES,
  capabilitySupport,
  createReconnectDetector,
  type EngineCapabilitiesState,
  testRunSupport,
  withheldReason,
} from "./engine-capabilities";

function ready(...capabilities: EngineCapability[]): EngineCapabilitiesState {
  return { status: "ready", report: { legacy: false, capabilities, withheld: [] } };
}

const LEGACY: EngineCapabilitiesState = { status: "ready", report: { legacy: true, capabilities: [], withheld: [] } };
const LOADING: EngineCapabilitiesState = { status: "loading" };
const FAILED: EngineCapabilitiesState = { status: "error", message: "fetch failed" };

describe("capabilitySupport", () => {
  test("needs every id", () => {
    const state = ready("analytics.sessions", "analytics.aggregates");
    expect(capabilitySupport(state, ["analytics.sessions", "analytics.aggregates"])).toBe("supported");
    expect(capabilitySupport(state, ["analytics.sessions", "analytics.gauges"])).toBe("unsupported");
  });

  test("is withheld when the build has every id but the engine is not entitled to some", () => {
    const state: EngineCapabilitiesState = {
      status: "ready",
      report: {
        legacy: false,
        capabilities: ["analytics.sessions"],
        withheld: [
          { id: "analytics.aggregates", reason: "plan" },
          { id: "analytics.gauges", reason: "rollout" },
        ],
      },
    };
    expect(capabilitySupport(state, ["analytics.sessions", "analytics.aggregates"])).toBe("withheld");
    expect(capabilitySupport(state, ["analytics.sessions", "obs.status"])).toBe("unsupported");
    expect(capabilitySupport(state, ["analytics.aggregates", "obs.status"])).toBe("unsupported");
    expect(withheldReason(state, ["analytics.sessions", "analytics.aggregates"])).toBe("plan");
    expect(withheldReason(state, ["analytics.gauges"])).toBe("rollout");
    expect(withheldReason(state, ["analytics.gauges", "analytics.aggregates"])).toBe("plan");
    expect(withheldReason(LOADING, ["analytics.gauges"])).toBe("rollout");
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
    expect(testRunSupport(ready("workflow.testRunOptions", "workflow.realCancel"), "checking")).toEqual({
      options: "supported",
      dryRun: "unsupported",
      realCancel: "supported",
    });
    expect(testRunSupport(ready("workflow.dryRun"), "checking")).toEqual({
      options: "unsupported",
      dryRun: "unsupported",
      realCancel: "unsupported",
    });
  });

  test("a legacy engine answers through the probe for all three", () => {
    expect(testRunSupport(LEGACY, "supported")).toEqual({
      options: "supported",
      dryRun: "supported",
      realCancel: "supported",
    });
    expect(testRunSupport(LEGACY, "checking").options).toBe("checking");
  });

  test("follows the capabilities request while it is out or failed", () => {
    expect(testRunSupport(LOADING, "unsupported").options).toBe("checking");
    expect(testRunSupport(FAILED, "unsupported").realCancel).toBe("unknown");
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
