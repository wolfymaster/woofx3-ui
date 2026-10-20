import { describe, expect, it } from "bun:test";
import {
  ENGINE_REPORT_REFRESH_MS,
  engineReportPatch,
  reportedCapabilityIds,
  reportedEngineVersion,
} from "./engineReport";

const NOW = 1_000_000_000;

describe("reportedEngineVersion", () => {
  it("keeps a trimmed version string", () => {
    expect(reportedEngineVersion(" v0.4.0 ")).toBe("v0.4.0");
    expect(reportedEngineVersion("dev")).toBe("dev");
  });

  it("drops what is not a version worth keeping", () => {
    expect(reportedEngineVersion(undefined)).toBeNull();
    expect(reportedEngineVersion(4)).toBeNull();
    expect(reportedEngineVersion("  ")).toBeNull();
    expect(reportedEngineVersion("v".repeat(65))).toBeNull();
  });
});

describe("reportedCapabilityIds", () => {
  it("keeps well-formed ids, sorted and unique, known or not", () => {
    expect(reportedCapabilityIds(["workflow.health", "future.feature", "workflow.health"])).toEqual([
      "future.feature",
      "workflow.health",
    ]);
  });

  it("drops ids that could never name a capability", () => {
    expect(reportedCapabilityIds(["", "nodot", "Upper.case", "a.b.c", "x".repeat(40), "obs.control"])).toEqual([
      "obs.control",
    ]);
  });

  it("keeps a bounded number", () => {
    const ids = Array.from({ length: 300 }, (_, index) => `area.feature${index}`);
    expect(reportedCapabilityIds(ids)).toHaveLength(256);
  });
});

describe("engineReportPatch", () => {
  it("records a first answer", () => {
    expect(engineReportPatch({}, { version: "v0.4.0" }, NOW)).toEqual({ engineVersion: "v0.4.0", engineSeenAt: NOW });
    expect(engineReportPatch({}, { capabilityIds: ["obs.control"] }, NOW)).toEqual({
      engineCapabilityIds: ["obs.control"],
      engineCapabilitiesSeenAt: NOW,
      engineSeenAt: NOW,
    });
  });

  it("records an engine that predates capabilities as listing none", () => {
    expect(engineReportPatch({}, { capabilityIds: [] }, NOW)?.engineCapabilityIds).toEqual([]);
  });

  it("writes nothing for an unchanged answer within the refresh window", () => {
    const current = {
      engineVersion: "v0.4.0",
      engineCapabilityIds: ["obs.control"],
      engineCapabilitiesSeenAt: NOW - 1000,
      engineSeenAt: NOW - 1000,
    };
    expect(engineReportPatch(current, { version: "v0.4.0" }, NOW)).toBeNull();
    expect(engineReportPatch(current, { capabilityIds: ["obs.control"] }, NOW)).toBeNull();
  });

  it("refreshes an unchanged answer once the window passes", () => {
    const seenAt = NOW - ENGINE_REPORT_REFRESH_MS;
    const current = {
      engineVersion: "v0.4.0",
      engineCapabilityIds: ["obs.control"],
      engineCapabilitiesSeenAt: seenAt,
      engineSeenAt: seenAt,
    };
    expect(engineReportPatch(current, { version: "v0.4.0" }, NOW)).toEqual({ engineSeenAt: NOW });
    expect(engineReportPatch(current, { capabilityIds: ["obs.control"] }, NOW)).toEqual({
      engineCapabilityIds: ["obs.control"],
      engineCapabilitiesSeenAt: NOW,
      engineSeenAt: NOW,
    });
  });

  it("writes a changed answer at once", () => {
    const current = {
      engineVersion: "v0.4.0",
      engineCapabilityIds: ["obs.control"],
      engineCapabilitiesSeenAt: NOW - 1000,
      engineSeenAt: NOW - 1000,
    };
    expect(engineReportPatch(current, { version: "v0.5.0" }, NOW)).toEqual({
      engineVersion: "v0.5.0",
      engineSeenAt: NOW,
    });
    expect(engineReportPatch(current, { capabilityIds: ["obs.control", "obs.status"] }, NOW)).toEqual({
      engineCapabilityIds: ["obs.control", "obs.status"],
      engineCapabilitiesSeenAt: NOW,
      engineSeenAt: NOW,
    });
  });

  it("clears a version the engine no longer reports", () => {
    const patch = engineReportPatch({ engineVersion: "v0.4.0", engineSeenAt: NOW - 1000 }, { version: null }, NOW);
    expect(patch).toEqual({ engineVersion: undefined, engineSeenAt: NOW });
    expect(patch && "engineVersion" in patch).toBe(true);
  });

  it("leaves capabilities alone when only the version was observed", () => {
    const patch = engineReportPatch({ engineCapabilityIds: ["obs.control"] }, { version: "v0.4.0" }, NOW);
    expect(patch && "engineCapabilityIds" in patch).toBe(false);
  });
});
