import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { parseManifestPermissions, readArchiveManifest, unapprovedPermissions } from "./modulePermissions";

function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = strToU8(content);
  }
  return zipSync(entries);
}

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

describe("readArchiveManifest", () => {
  test("reads a root manifest", () => {
    const zip = archive({ "manifest.json": JSON.stringify({ id: "m", permissions: ["x"] }), "index.js": "" });
    expect(readArchiveManifest(zip)).toEqual({ id: "m", permissions: ["x"] });
  });

  test("the shallowest manifest wins over a nested one", () => {
    const zip = archive({
      "wrap/node_modules/dep/manifest.json": JSON.stringify({ id: "dep" }),
      "wrap/manifest.json": JSON.stringify({ id: "m" }),
    });
    expect(readArchiveManifest(zip)).toEqual({ id: "m" });
  });

  test("a file that only ends in manifest.json is not a manifest", () => {
    const zip = archive({ "notmanifest.json": "{}" });
    expect(() => readArchiveManifest(zip)).toThrow("contains no manifest.json");
  });

  test("an unparseable manifest fails loudly", () => {
    expect(() => readArchiveManifest(archive({ "manifest.json": "{nope" }))).toThrow("is not valid JSON");
    expect(() => readArchiveManifest(archive({ "manifest.json": "[]" }))).toThrow("is not a JSON object");
  });
});
