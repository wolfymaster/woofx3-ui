import { describe, expect, test } from "bun:test";
import { MODULE_FILE_TEXT_LIMIT_BYTES } from "@woofx3/api/api";
import { strToU8, zipSync } from "fflate";
import {
  classifyModuleFile,
  listArchiveModuleFiles,
  moduleArchiveRoot,
  normalizeArchivePath,
  readArchiveModuleFile,
} from "./moduleArchiveFiles";

function archive(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    entries[path] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(entries);
}

describe("normalizeArchivePath", () => {
  test("strips leading ./ and slashes and converts backslashes", () => {
    expect(normalizeArchivePath("./a/b.js")).toBe("a/b.js");
    expect(normalizeArchivePath("/a/b.js")).toBe("a/b.js");
    expect(normalizeArchivePath("a\\b.js")).toBe("a/b.js");
  });

  test("rejects .. segments", () => {
    expect(normalizeArchivePath("a/../b.js")).toBeNull();
  });
});

describe("moduleArchiveRoot", () => {
  test("is empty for a root manifest", () => {
    expect(moduleArchiveRoot(["manifest.json", "functions/a.js"])).toBe("");
  });

  test("is the wrapper directory when the manifest is nested", () => {
    expect(moduleArchiveRoot(["demo/manifest.json", "demo/functions/a.js"])).toBe("demo/");
  });

  test("prefers the shallowest manifest", () => {
    expect(moduleArchiveRoot(["demo/vendor/dep/manifest.json", "demo/manifest.json"])).toBe("demo/");
  });

  test("prefers manifest.json over module.json at any depth", () => {
    expect(moduleArchiveRoot(["module.json", "demo/Manifest.JSON"])).toBe("demo/");
  });

  test("ignores manifests inside archiver junk", () => {
    expect(moduleArchiveRoot(["__MACOSX/manifest.json", "demo/manifest.json"])).toBe("demo/");
  });

  test("does not treat other JSON as a manifest", () => {
    expect(moduleArchiveRoot(["demo/assets/bit_overlay.json"])).toBe("");
  });
});

describe("listArchiveModuleFiles", () => {
  test("lists files relative to the root, sorted, without directories, junk or outsiders", () => {
    const zip = zipSync({
      "demo/": new Uint8Array(),
      "demo/manifest.json": strToU8("{}"),
      "demo/functions/b.js": strToU8("b"),
      "demo/functions/a.js": strToU8("aaaa"),
      "demo/.DS_Store": strToU8("x"),
      "__MACOSX/demo/._manifest.json": strToU8("x"),
      "other/readme.txt": strToU8("x"),
    });
    expect(listArchiveModuleFiles(zip)).toEqual({
      available: true,
      files: [
        { path: "functions/a.js", size: 4 },
        { path: "functions/b.js", size: 1 },
        { path: "manifest.json", size: 2 },
      ],
    });
  });
});

describe("readArchiveModuleFile", () => {
  const zip = archive({
    "demo/manifest.json": '{"id":"demo"}',
    "demo/assets/logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    "other/secret.txt": "nope",
  });

  test("reads a text file by its module-relative path", () => {
    expect(readArchiveModuleFile(zip, "manifest.json")).toEqual({
      path: "manifest.json",
      size: 13,
      kind: "text",
      content: '{"id":"demo"}',
    });
  });

  test("classifies a binary file without content", () => {
    expect(readArchiveModuleFile(zip, "assets/logo.png")).toEqual({ path: "assets/logo.png", size: 6, kind: "binary" });
  });

  test("throws the engine's not-found message for a path outside the module", () => {
    expect(() => readArchiveModuleFile(zip, "../other/secret.txt")).toThrow("file not found in module");
    expect(() => readArchiveModuleFile(zip, "missing.js")).toThrow("file not found in module: missing.js");
  });
});

describe("classifyModuleFile", () => {
  test("text for valid UTF-8", () => {
    expect(classifyModuleFile("a.md", strToU8("héllo"), 6)).toEqual({
      path: "a.md",
      size: 6,
      kind: "text",
      content: "héllo",
    });
  });

  test("binary for a NUL byte", () => {
    expect(classifyModuleFile("a.bin", new Uint8Array([65, 0, 66]), 3).kind).toBe("binary");
  });

  test("binary for invalid UTF-8", () => {
    expect(classifyModuleFile("a.bin", new Uint8Array([0xff, 0xfe, 0x41]), 3).kind).toBe("binary");
  });

  test("text at exactly the limit", () => {
    const bytes = new Uint8Array(MODULE_FILE_TEXT_LIMIT_BYTES).fill(0x61);
    expect(classifyModuleFile("a.txt", bytes, bytes.byteLength).kind).toBe("text");
  });

  test("too_large for text over the limit, ignoring a character the cut split", () => {
    const bytes = new Uint8Array(MODULE_FILE_TEXT_LIMIT_BYTES + 1).fill(0x61);
    // First byte of a two-byte "é", cut off by the read cap.
    bytes[MODULE_FILE_TEXT_LIMIT_BYTES] = 0xc3;
    expect(classifyModuleFile("a.txt", bytes, MODULE_FILE_TEXT_LIMIT_BYTES + 10)).toEqual({
      path: "a.txt",
      size: MODULE_FILE_TEXT_LIMIT_BYTES + 10,
      kind: "too_large",
    });
  });
});
