import { describe, expect, it } from "bun:test";
import { engineBelowMinimum, MIN_SUPPORTED_ENGINE_VERSION } from "./engineVersion";
import { parseRelease } from "./releaseVersion";

describe("MIN_SUPPORTED_ENGINE_VERSION", () => {
  it("is unset or a release", () => {
    if (MIN_SUPPORTED_ENGINE_VERSION !== null) {
      expect(parseRelease(MIN_SUPPORTED_ENGINE_VERSION)).not.toBeNull();
    }
  });
});

describe("engineBelowMinimum", () => {
  it("treats no engine as too old while no minimum is set", () => {
    expect(engineBelowMinimum({ engineVersion: "v0.0.1" }, null)).toBe(false);
  });

  it.each([
    ["v0.3.9", true],
    ["0.3.9", true],
    ["v0.4.0-rc.1", true],
    ["v0.4.0", false],
    ["0.4.0", false],
    ["v0.10.0", false],
  ])("%s against v0.4.0 is below: %p", (version, below) => {
    expect(engineBelowMinimum({ engineVersion: version }, "v0.4.0")).toBe(below);
  });

  it.each([["dev"], ["pr-12-abc1234"], [""], ["latest"]])("treats %p as unknown, not below", (version) => {
    expect(engineBelowMinimum({ engineVersion: version }, "v0.4.0")).toBe(false);
  });

  it("treats an engine that never reported a version as unknown", () => {
    expect(engineBelowMinimum({}, "v0.4.0")).toBe(false);
  });
});
