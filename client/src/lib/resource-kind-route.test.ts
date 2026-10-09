import { describe, expect, test } from "bun:test";
import { builtInKindRoutes, isBuiltInKind, pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";

describe("resourceKindPath", () => {
  test("keeps a built-in kind at its own address", () => {
    expect(resourceKindPath("woofx3", "counter")).toBe("/stream/counters");
    expect(isBuiltInKind("woofx3", "timer")).toBe(true);
  });

  test("routes each built-in kind at the address its page lists it under", () => {
    for (const { moduleName, kind, path } of builtInKindRoutes()) {
      expect(isBuiltInKind(moduleName, kind)).toBe(true);
      expect(resourceKindPath(moduleName, kind)).toBe(path);
    }
    expect(builtInKindRoutes().map((route) => route.path)).toEqual([
      "/stream/counters",
      "/stream/timers",
      "/stream/queues",
    ]);
  });

  test("puts any other module's kind under the generic page", () => {
    expect(resourceKindPath("woofx3_wheel_spin", "wheel")).toBe("/stream/resources/woofx3_wheel_spin/wheel");
    expect(isBuiltInKind("rival", "counter")).toBe(false);
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
