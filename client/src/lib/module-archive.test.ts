import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { buildModuleArchive, computeModuleKey, getCommonDirectoryPrefix, readModuleArchive } from "./module-archive";

const manifest = JSON.stringify({ id: "hello_world", name: "Hello World", version: "1.2.0" });
const handler = 'export function main(ctx) {\n  return { message: "héllo ✓" };\n}\n';

// An archive as a user would zip it from a folder: a wrapper directory with
// explicit directory entries.
function wrappedUpload(): Uint8Array {
  return zipSync({
    "hello/": new Uint8Array(0),
    "hello/functions/": new Uint8Array(0),
    "hello/manifest.json": strToU8(manifest),
    "hello/functions/main.js": strToU8(handler),
  });
}

describe("readModuleArchive", () => {
  test("returns file entries as text and drops directory entries", () => {
    expect(readModuleArchive(wrappedUpload())).toEqual({
      "hello/manifest.json": manifest,
      "hello/functions/main.js": handler,
    });
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
  test("round-trips the files at the archive root", () => {
    const archive = buildModuleArchive(readModuleArchive(wrappedUpload()));
    expect(readModuleArchive(archive)).toEqual({
      "manifest.json": manifest,
      "functions/main.js": handler,
    });
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
