import { describe, expect, test } from "bun:test";
import type { Doc } from "../_generated/dataModel";
import { userPagesAllowed } from "./userPages";

describe("userPagesAllowed", () => {
  const cases: [string, Doc<"instances">["hosting"], string[], boolean][] = [
    ["a managed engine without the feature", "managed", [], true],
    ["a managed engine with the feature", "managed", ["userPages"], true],
    ["an external engine with the feature", "external", ["userPages"], true],
    ["an external engine without the feature", "external", [], false],
    ["an engine predating hosting, without the feature", undefined, [], false],
    ["an engine predating hosting, with the feature", undefined, ["userPages"], true],
    ["an external engine with only other features", "external", ["reports.advanced"], false],
  ];

  test.each(cases)("%s", (_name, hosting, features, allowed) => {
    expect(userPagesAllowed(hosting, features)).toBe(allowed);
  });
});
