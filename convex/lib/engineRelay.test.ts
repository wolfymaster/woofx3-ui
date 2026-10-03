import { describe, expect, test } from "bun:test";
import { isCompanionHostname } from "./engineRelay";

describe("isCompanionHostname", () => {
  test("accepts c- and twelve base32 characters under any domain", () => {
    expect(isCompanionHostname("c-abcdefghijkl.woofx3.tv")).toBe(true);
    expect(isCompanionHostname("c-a2b3c4d5e6f7.relay.example.com")).toBe(true);
  });

  test("refuses anything else", () => {
    for (const hostname of [
      "c-abcdefghijk.woofx3.tv",
      "c-abcdefghijklm.woofx3.tv",
      "c-abcdefghijk1.woofx3.tv",
      "c-ABCDEFGHIJKL.woofx3.tv",
      "c-abcdefghijkl",
      "x-abcdefghijkl.woofx3.tv",
      "c-abcdefghijkl.woofx3.tv/path",
      "c-abcdefghijkl..woofx3.tv",
    ]) {
      expect(isCompanionHostname(hostname)).toBe(false);
    }
  });
});
