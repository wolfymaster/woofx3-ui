import { describe, expect, test } from "bun:test";
import { canonicalIdForStorageKey } from "./resource-values";

describe("canonicalIdForStorageKey", () => {
  test.each([
    ["a resource value's key", "state:counter:counter:deaths", "counter:counter:deaths"],
    ["the bare prefix", "state:", null],
    ["any other key", "settings:theme", null],
    ["the prefix later in the key", "x:state:counter", null],
  ])("%s", (_case, key, canonicalId) => {
    expect(canonicalIdForStorageKey(key)).toBe(canonicalId);
  });
});
