import { describe, expect, test } from "bun:test";
import { visibleModules } from "./engine-modules";

const modules = [
  { _id: "1", name: "Wheel", version: "1.0.0", category: "games" },
  { _id: "2", name: "Alerts+", version: "2.0.0", author: "Ada", status: "installed" as const },
  { _id: "3", name: "Zeta", version: "0.1.0", status: "failed" as const, statusMessage: "bad archive" },
];

describe("visibleModules", () => {
  test("puts a module with a problem first, then the rest by name", () => {
    expect(visibleModules(modules, "").map((module) => module.name)).toEqual(["Zeta", "Alerts+", "Wheel"]);
  });

  test("searches name, author and category, ignoring case and padding", () => {
    expect(visibleModules(modules, " ada ").map((module) => module.name)).toEqual(["Alerts+"]);
    expect(visibleModules(modules, "GAMES").map((module) => module.name)).toEqual(["Wheel"]);
    expect(visibleModules(modules, "nothing")).toEqual([]);
  });
});
