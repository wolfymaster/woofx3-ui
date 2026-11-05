import { describe, expect, test } from "bun:test";
import { engineAddress } from "./engine-address";

describe("engineAddress", () => {
  test.each([
    { name: "not published yet", publicUrl: undefined, slug: "wolfy", expected: null },
    { name: "never renamed", publicUrl: "https://wolfy.woofx3.tv", slug: "wolfy", expected: "https://wolfy.woofx3.tv" },
    { name: "renamed", publicUrl: "https://wolfy.woofx3.tv", slug: "new-name", expected: "https://new-name.woofx3.tv" },
  ])("$name", ({ publicUrl, slug, expected }) => {
    expect(engineAddress(publicUrl, slug)).toBe(expected);
  });
});
