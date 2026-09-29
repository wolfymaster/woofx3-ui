import { describe, expect, test } from "bun:test";
import { usedByContext, usedByHeading } from "./uninstall-conflicts";

describe("uninstall conflict wording", () => {
  test("a module other modules depend on is required by them", () => {
    expect(usedByHeading("module")).toBe("Required by:");
    expect(usedByContext("module", "requires ^1.2.0")).toBe("(requires ^1.2.0)");
  });

  test("a resource in use keeps the used-by wording", () => {
    expect(usedByHeading("trigger")).toBe("Used by:");
    expect(usedByHeading(undefined)).toBe("Used by:");
    expect(usedByContext("trigger", "trigger")).toBe("(as trigger)");
  });

  test("no context adds nothing", () => {
    expect(usedByContext("module", undefined)).toBeNull();
    expect(usedByContext("trigger", "")).toBeNull();
  });
});
