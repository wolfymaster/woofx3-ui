import { describe, expect, test } from "bun:test";
import { hasFirstPartyPage, pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";

describe("resourceKindPath", () => {
  test("keeps a first-party kind at its own page", () => {
    expect(resourceKindPath("woofx3", "counter")).toBe("/stream/counters");
    expect(hasFirstPartyPage("woofx3", "timer")).toBe(true);
  });

  test("puts any other module's kind under the generic page", () => {
    expect(resourceKindPath("woofx3_wheel_spin", "wheel")).toBe("/stream/resources/woofx3_wheel_spin/wheel");
    expect(hasFirstPartyPage("rival", "counter")).toBe(false);
  });
});

describe("pluralKindName", () => {
  test("follows the common English endings", () => {
    expect(pluralKindName("Wheel")).toBe("Wheels");
    expect(pluralKindName("Box")).toBe("Boxes");
    expect(pluralKindName("Bounty")).toBe("Bounties");
    expect(pluralKindName("Day")).toBe("Days");
  });
});
