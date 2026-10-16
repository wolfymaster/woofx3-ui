import { describe, expect, it } from "bun:test";
import { compareReleases, isUpgrade, parseRelease } from "./releaseVersion";

function order(a: string, b: string): number {
  const left = parseRelease(a);
  const right = parseRelease(b);
  if (!left || !right) {
    throw new Error(`not a release: ${left ? b : a}`);
  }
  return Math.sign(compareReleases(left, right));
}

describe("compareReleases", () => {
  it.each([
    ["v0.2.0", "v0.1.0", 1],
    ["v0.10.0", "v0.9.9", 1],
    ["v1.0.0", "v0.99.99", 1],
    ["v0.2.0", "v0.2.0", 0],
    ["0.2.0", "v0.2.0", 0],
    ["v0.2.0", "v0.2.0-rc.1", 1],
    ["v0.2.0-rc.2", "v0.2.0-rc.1", 1],
    ["v0.2.0-rc.10", "v0.2.0-rc.9", 1],
    ["v0.2.0-rc.1", "v0.2.0-rc", 1],
    ["v0.2.0-beta", "v0.2.0-alpha", 1],
    ["v0.2.0-alpha", "v0.2.0-1", 1],
  ])("%s against %s is %i", (a, b, expected) => {
    expect(order(a, b)).toBe(expected);
    expect(order(b, a)).toBe(-expected || 0);
  });
});

describe("isUpgrade", () => {
  it("offers a newer release", () => {
    expect(isUpgrade("v0.3.0", "v0.2.0")).toBe(true);
    expect(isUpgrade("v0.3.0", "v0.3.0-rc.1")).toBe(true);
  });

  it("does not offer the release the engine runs", () => {
    expect(isUpgrade("v0.3.0", "v0.3.0")).toBe(false);
  });

  it("does not offer an older release to an engine an operator moved ahead", () => {
    expect(isUpgrade("v0.3.0", "v0.4.0")).toBe(false);
    expect(isUpgrade("v0.3.0", "v0.4.0-rc.1")).toBe(false);
  });

  it("does not offer anything to an engine on a build outside the release order", () => {
    expect(isUpgrade("v0.3.0", "pr-42-abc1234")).toBe(false);
    expect(isUpgrade("v0.3.0", null)).toBe(false);
    expect(isUpgrade("latest", "v0.2.0")).toBe(false);
  });
});
