import { describe, expect, test } from "bun:test";
import { parseManifestPermissions, unapprovedPermissions } from "./module-permissions";

describe("parseManifestPermissions", () => {
  test("reads the declared ids in order", () => {
    expect(parseManifestPermissions({ permissions: ["twitch.moderation", "twitch.channel"] })).toEqual([
      "twitch.moderation",
      "twitch.channel",
    ]);
  });

  test("drops duplicates, empty strings and non-strings", () => {
    expect(parseManifestPermissions({ permissions: ["a", "", 3, null, "a", "b"] })).toEqual(["a", "b"]);
  });

  test("a manifest without the field declares nothing", () => {
    expect(parseManifestPermissions({ id: "m" })).toEqual([]);
    expect(parseManifestPermissions({ permissions: "twitch.channel" })).toEqual([]);
    expect(parseManifestPermissions(undefined)).toEqual([]);
    expect(parseManifestPermissions(null)).toEqual([]);
  });
});

describe("unapprovedPermissions", () => {
  test("lists the requested ids that were not approved", () => {
    expect(unapprovedPermissions(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  test("is empty when everything was approved", () => {
    expect(unapprovedPermissions(["a"], ["a", "b"])).toEqual([]);
    expect(unapprovedPermissions([], [])).toEqual([]);
  });
});
