import { describe, expect, test } from "bun:test";
import { bareModuleKey, findModuleRow, type ModuleRowIdentity } from "./moduleKey";

function row(id: string, moduleKey: string | undefined, name: string, version: string): ModuleRowIdentity {
  return { _id: id, moduleKey, name, version };
}

function snap(name: string, version: string, moduleKey: string, moduleId = "") {
  return { name, version, moduleKey, moduleId };
}

describe("bareModuleKey", () => {
  test("drops the version and content hash", () => {
    expect(bareModuleKey("woofx3_twitch:0.1.1:eb5e20f")).toBe("woofx3_twitch");
  });

  test("is undefined for a key that carries nothing", () => {
    expect(bareModuleKey(undefined)).toBeUndefined();
    expect(bareModuleKey("")).toBeUndefined();
  });
});

describe("findModuleRow", () => {
  const none = new Set<string>();

  test("prefers the row written under the exact same key", () => {
    const rows = [
      row("a", "woofx3:0.7.0:dcbcc35", "woofx3", "0.7.0"),
      row("b", "woofx3:0.6.0:aaaaaaa", "woofx3", "0.6.0"),
    ];
    expect(findModuleRow(rows, snap("woofx3", "0.6.0", "woofx3:0.6.0:aaaaaaa"), none)?._id).toBe("b");
  });

  // The case the whole helper exists for: an upgrade rewrites the key, so the
  // row installed under the old version must still be recognised as this module
  // rather than inserted again alongside itself.
  test("matches across a version bump on the bare key", () => {
    const rows = [row("a", "woofx3:0.6.0:aaaaaaa", "woofx3", "0.6.0")];
    expect(findModuleRow(rows, snap("woofx3", "0.7.0", "woofx3:0.7.0:dcbcc35"), none)?._id).toBe("a");
  });

  test("falls back to name and version for a row that predates moduleKey", () => {
    const rows = [row("a", undefined, "woofx3", "0.7.0")];
    expect(findModuleRow(rows, snap("woofx3", "0.7.0", "woofx3:0.7.0:dcbcc35"), none)?._id).toBe("a");
  });

  // Without the claim set both snapshots fall through to the same bare-key
  // match, and reconciling the second would overwrite the first rather than
  // insert a row of its own.
  test("will not hand one row to two snapshots", () => {
    const rows = [row("a", "woofx3:0.6.0:aaaaaaa", "woofx3", "0.6.0")];
    const first = findModuleRow(rows, snap("woofx3", "0.7.0", "woofx3:0.7.0:dcbcc35"), none);
    expect(first?._id).toBe("a");
    const claimed = new Set([first?._id ?? ""]);
    expect(findModuleRow(rows, snap("woofx3", "0.8.0", "woofx3:0.8.0:bbbbbbb"), claimed)).toBeUndefined();
  });

  test("is undefined when nothing corresponds, so the caller inserts", () => {
    const rows = [row("a", "woofx3:0.7.0:dcbcc35", "woofx3", "0.7.0")];
    expect(findModuleRow(rows, snap("other", "1.0.0", "other:1.0.0:ccccccc"), none)).toBeUndefined();
  });

  // A snapshot with no key at all still has to resolve; the engine's moduleId
  // is what stands in for the bare key.
  test("uses moduleId as the bare key when the snapshot carries none", () => {
    const rows = [row("a", "woofx3:0.7.0:dcbcc35", "woofx3", "0.7.0")];
    expect(findModuleRow(rows, snap("woofx3", "0.7.0", "", "woofx3"), none)?._id).toBe("a");
  });
});
