import { describe, expect, it } from "bun:test";
import { ENGINE_CAPABILITY_IDS } from "../engineCapabilities";
import {
  DEFAULT_ACTIVE_DAYS,
  type EngineReportRow,
  parseActiveDays,
  tallyEngineCapabilities,
} from "./engineCapabilityCounts";

const OPTIONS = { days: 30, activeSince: 100, nowMs: 200, minimumSupportedVersion: null };

const ROWS: EngineReportRow[] = [
  { hosting: "managed", version: "v0.5.0", capabilityIds: ["obs.control", "obs.status"] },
  { hosting: "managed", version: "v0.4.0", capabilityIds: ["obs.status"] },
  { hosting: "external", version: "dev", capabilityIds: ["future.feature", "obs.control"] },
  { hosting: "external", version: "v0.4.0", capabilityIds: [] },
  { hosting: "external", version: null, capabilityIds: null },
];

describe("tallyEngineCapabilities", () => {
  const counts = tallyEngineCapabilities(ROWS, OPTIONS);
  const byId = new Map(counts.capabilities.map((row) => [row.id, row]));

  it("counts active instances by hosting, and those with no capability list apart", () => {
    expect(counts.instances).toEqual({ managed: 2, external: 3 });
    expect(counts.unreported).toEqual({ managed: 0, external: 1 });
  });

  it("splits each id into have and lack among instances that reported a list", () => {
    expect(byId.get("obs.control")).toEqual({
      id: "obs.control",
      known: true,
      have: { managed: 1, external: 1 },
      lack: { managed: 1, external: 1 },
    });
    expect(byId.get("obs.status")).toEqual({
      id: "obs.status",
      known: true,
      have: { managed: 2, external: 0 },
      lack: { managed: 0, external: 2 },
    });
  });

  it("lists every known id, and every reported id it does not know", () => {
    for (const id of ENGINE_CAPABILITY_IDS) {
      expect(byId.has(id)).toBe(true);
    }
    expect(byId.get("future.feature")?.known).toBe(false);
    const ids = counts.capabilities.map((row) => row.id);
    expect(ids).toEqual([...ids].sort());
  });

  it("orders versions newest release first, then other versions, then none", () => {
    expect(counts.versions.map((row) => [row.version, row.count])).toEqual([
      ["v0.5.0", { managed: 1, external: 0 }],
      ["v0.4.0", { managed: 1, external: 1 }],
      ["dev", { managed: 0, external: 1 }],
      [null, { managed: 0, external: 1 }],
    ]);
  });

  it("counts nothing below an unset minimum", () => {
    expect(counts.belowMinimum).toEqual({ managed: 0, external: 0 });
    expect(counts.versions.every((row) => !row.belowMinimum)).toBe(true);
  });

  it("counts releases below a set minimum, never dev or missing versions", () => {
    const withMinimum = tallyEngineCapabilities(ROWS, { ...OPTIONS, minimumSupportedVersion: "v0.5.0" });
    expect(withMinimum.belowMinimum).toEqual({ managed: 1, external: 1 });
    expect(withMinimum.versions.filter((row) => row.belowMinimum).map((row) => row.version)).toEqual(["v0.4.0"]);
  });

  it("answers an empty fleet with zeros", () => {
    const empty = tallyEngineCapabilities([], OPTIONS);
    expect(empty.instances).toEqual({ managed: 0, external: 0 });
    expect(empty.versions).toEqual([]);
    for (const row of empty.capabilities) {
      expect([row.have, row.lack]).toEqual([
        { managed: 0, external: 0 },
        { managed: 0, external: 0 },
      ]);
    }
  });
});

describe("parseActiveDays", () => {
  it("defaults when absent", () => {
    expect(parseActiveDays(null)).toBe(DEFAULT_ACTIVE_DAYS);
    expect(parseActiveDays("")).toBe(DEFAULT_ACTIVE_DAYS);
  });

  it("accepts whole days from 1 to 365", () => {
    expect(parseActiveDays("1")).toBe(1);
    expect(parseActiveDays("365")).toBe(365);
  });

  it.each([["0"], ["366"], ["-1"], ["1.5"], ["7d"], ["1e2"]])("refuses %p", (raw) => {
    expect(parseActiveDays(raw)).toBeNull();
  });
});
