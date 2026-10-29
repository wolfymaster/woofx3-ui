import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, zipSync } from "fflate";
import {
  buildModuleArchive,
  computeModuleKey,
  getCommonDirectoryPrefix,
  moduleArchiveFileName,
  readModuleArchive,
  textFilesOf,
  textOf,
} from "./module-archive";

const manifest = JSON.stringify({ id: "hello_world", name: "Hello World", version: "1.2.0" });
const handler = 'export function main(ctx) {\n  return { message: "héllo ✓" };\n}\n';
// The start of a PNG: not valid UTF-8, and holding NUL bytes.
const icon = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe]);

// An archive as a user would zip it from a folder: a wrapper directory with
// explicit directory entries.
function wrappedUpload(): Uint8Array {
  return zipSync({
    "hello/": new Uint8Array(0),
    "hello/functions/": new Uint8Array(0),
    "hello/manifest.json": strToU8(manifest),
    "hello/functions/main.js": strToU8(handler),
    "hello/assets/icon.png": icon,
  });
}

const decoded = (files: Record<string, Uint8Array>) =>
  Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Array.from(bytes)]));

describe("readModuleArchive", () => {
  test("returns every file entry's bytes as stored and drops directory entries", () => {
    expect(decoded(readModuleArchive(wrappedUpload()))).toEqual({
      "hello/manifest.json": Array.from(strToU8(manifest)),
      "hello/functions/main.js": Array.from(strToU8(handler)),
      "hello/assets/icon.png": Array.from(icon),
    });
  });
});

describe("textOf", () => {
  test.each([
    ["UTF-8 text", strToU8(handler), handler],
    ["an empty file", new Uint8Array(0), ""],
    ["bytes that are not UTF-8", new Uint8Array([0xff, 0xfe, 0x41]), null],
    ["valid UTF-8 holding a NUL byte", new Uint8Array([0x41, 0x00, 0x42]), null],
  ] as const)("%s", (_case, bytes, text) => {
    expect(textOf(bytes)).toBe(text);
  });

  test("the text files of an archive leave its binary files out", () => {
    expect(Object.keys(textFilesOf(readModuleArchive(wrappedUpload()))).sort()).toEqual([
      "hello/functions/main.js",
      "hello/manifest.json",
    ]);
  });
});

describe("getCommonDirectoryPrefix", () => {
  test("finds a shared wrapper directory", () => {
    expect(getCommonDirectoryPrefix(["a/manifest.json", "a/b/c.js"])).toBe("a/");
  });

  test("is empty for root files or differing directories", () => {
    expect(getCommonDirectoryPrefix(["manifest.json", "a/c.js"])).toBe("");
    expect(getCommonDirectoryPrefix(["a/manifest.json", "b/c.js"])).toBe("");
    expect(getCommonDirectoryPrefix([])).toBe("");
  });
});

describe("buildModuleArchive", () => {
  test("round-trips every file's bytes, binary ones included, at the archive root", () => {
    const archive = buildModuleArchive(readModuleArchive(wrappedUpload()));
    expect(decoded(readModuleArchive(archive))).toEqual({
      "manifest.json": Array.from(strToU8(manifest)),
      "functions/main.js": Array.from(strToU8(handler)),
      "assets/icon.png": Array.from(icon),
    });
    expect(strFromU8(readModuleArchive(archive)["functions/main.js"])).toBe(handler);
  });

  // The engine extracts uploads with the system `unzip` binary
  // (barkloader's file_service), so the archive must be readable by it.
  test.skipIf(spawnSync("unzip", ["-v"]).status !== 0)("extracts with unzip as the engine does", () => {
    const dir = mkdtempSync(join(tmpdir(), "module-archive-"));
    try {
      const zipPath = join(dir, "module.zip");
      writeFileSync(zipPath, buildModuleArchive(readModuleArchive(wrappedUpload())));
      const result = spawnSync("unzip", ["-o", zipPath, "-d", dir]);
      expect(result.status).toBe(0);
      expect(readFileSync(join(dir, "manifest.json"), "utf8")).toBe(manifest);
      expect(readFileSync(join(dir, "functions/main.js"), "utf8")).toBe(handler);
      expect(Array.from(readFileSync(join(dir, "assets/icon.png")))).toEqual(Array.from(icon));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("computeModuleKey", () => {
  // The archive travels browser Blob -> Convex storage -> base64 -> engine, which
  // hashes the bytes it receives. The key must survive that trip unchanged.
  test("matches the engine's key for the bytes it receives", async () => {
    const archive = buildModuleArchive(readModuleArchive(wrappedUpload()));
    const uploaded = new Uint8Array(await new Blob([archive], { type: "application/zip" }).arrayBuffer());
    const received = Buffer.from(Buffer.from(uploaded).toString("base64"), "base64");

    const engineHash = createHash("sha256").update(received).digest("hex");
    const engineKey = `hello_world:1.2.0:${engineHash.slice(0, 7)}`;

    expect(await computeModuleKey("hello_world", "1.2.0", archive)).toBe(engineKey);
  });
});

describe("moduleArchiveFileName", () => {
  test("names a stored archive after its module key, with no colons", async () => {
    const archive = buildModuleArchive(readModuleArchive(wrappedUpload()));
    const key = await computeModuleKey("hello_world", "1.2.0", archive);
    expect(await moduleArchiveFileName("hello_world", "1.2.0", archive)).toBe(`${key.replaceAll(":", "-")}.zip`);
  });
});
