import { describe, expect, test } from "bun:test";
import {
  ENGINE_CAPABILITY_IDS,
  hasEngineCapability,
  isLegacyCapabilitiesError,
  parseEngineCapabilities,
} from "./engineCapabilities";

describe("parseEngineCapabilities", () => {
  test("keeps known ids, sorted and unique", () => {
    const report = parseEngineCapabilities({
      schema: 1,
      capabilities: ["workflow.health", "obs.listScenes", "workflow.health"],
    });
    expect(report).toEqual({ legacy: false, capabilities: ["obs.listScenes", "workflow.health"] });
    expect(hasEngineCapability(report, "workflow.health")).toBe(true);
    expect(hasEngineCapability(report, "config.bundles")).toBe(false);
  });

  test("ignores ids this dashboard does not know", () => {
    const report = parseEngineCapabilities({ schema: 1, capabilities: ["future.feature", 7, "config.bundles"] });
    expect(report.capabilities).toEqual(["config.bundles"]);
  });

  test("refuses a response shape it cannot read", () => {
    expect(() => parseEngineCapabilities({ schema: 2, capabilities: [] })).toThrow("schema 2");
    expect(() => parseEngineCapabilities({ schema: 1 })).toThrow("without a capabilities list");
    expect(() => parseEngineCapabilities(null)).toThrow();
  });

  test("declares each id once, in <area>.<feature> form", () => {
    expect(new Set(ENGINE_CAPABILITY_IDS).size).toBe(ENGINE_CAPABILITY_IDS.length);
    for (const id of ENGINE_CAPABILITY_IDS) {
      expect(id).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });
});

describe("isLegacyCapabilitiesError", () => {
  test("recognises an engine that predates the method", () => {
    expect(isLegacyCapabilitiesError(new TypeError("'getEngineCapabilities' is not a function."))).toBe(true);
    expect(isLegacyCapabilitiesError("'getEngineCapabilities' is not a function.")).toBe(true);
  });

  test("treats every other failure as a real one", () => {
    expect(isLegacyCapabilitiesError(new TypeError("fetch failed"))).toBe(false);
    expect(isLegacyCapabilitiesError(new TypeError("'listObsScenes' is not a function."))).toBe(false);
    expect(isLegacyCapabilitiesError(undefined)).toBe(false);
  });
});
