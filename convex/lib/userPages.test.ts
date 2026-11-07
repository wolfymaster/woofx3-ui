import { describe, expect, test } from "bun:test";
import type { Doc } from "../_generated/dataModel";
import { userPagesAllowed } from "./userPages";

describe("userPagesAllowed", () => {
  const cases: [string, Doc<"instances">["hosting"], boolean][] = [
    ["a managed engine", "managed", true],
    ["an external engine", "external", false],
    ["an engine predating hosting", undefined, false],
  ];

  test.each(cases)("%s", (_name, hosting, allowed) => {
    expect(userPagesAllowed(hosting)).toBe(allowed);
  });
});
