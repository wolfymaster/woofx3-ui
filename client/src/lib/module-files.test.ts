import { describe, expect, test } from "bun:test";
import {
  buildModuleFileTree,
  formatFileSize,
  getFileCategory,
  getLanguageFromPath,
  matchFunctionFile,
} from "./module-files";

describe("getLanguageFromPath", () => {
  test.each([
    ["manifest.json", "json"],
    ["functions/battle.js", "javascript"],
    ["lib/util.mjs", "javascript"],
    ["lib/util.cjs", "javascript"],
    ["src/index.ts", "typescript"],
    ["functions/main.lua", "lua"],
    ["widgets/overlay.html", "html"],
    ["widgets/overlay.css", "css"],
    ["README.md", "markdown"],
    ["assets/icon.svg", "xml"],
    ["data/feed.xml", "xml"],
    ["config.yaml", "yaml"],
    ["config.yml", "yaml"],
    ["notes.txt", "plaintext"],
    ["LICENSE", "plaintext"],
    ["archive.bin", "plaintext"],
    ["Widget.JSON", "json"],
    [".env", "plaintext"],
  ])("%s → %s", (path, language) => {
    expect(getLanguageFromPath(path)).toBe(language);
  });
});

describe("getFileCategory", () => {
  test("groups files by extension", () => {
    expect(getFileCategory("a/b.js")).toBe("code");
    expect(getFileCategory("manifest.json")).toBe("data");
    expect(getFileCategory("w/overlay.html")).toBe("markup");
    expect(getFileCategory("assets/logo.PNG")).toBe("image");
    expect(getFileCategory("README.md")).toBe("text");
    expect(getFileCategory("blob")).toBe("other");
  });
});

describe("buildModuleFileTree", () => {
  test("nests files under folders, folders first, sorted by name", () => {
    const tree = buildModuleFileTree([
      { path: "manifest.json", size: 10 },
      { path: "README.md", size: 5 },
      { path: "functions/b.js", size: 2 },
      { path: "functions/a.js", size: 1 },
      { path: "widgets/overlay/index.html", size: 3 },
    ]);
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "functions",
        path: "functions",
        children: [
          { kind: "file", name: "a.js", path: "functions/a.js", size: 1 },
          { kind: "file", name: "b.js", path: "functions/b.js", size: 2 },
        ],
      },
      {
        kind: "folder",
        name: "widgets",
        path: "widgets",
        children: [
          {
            kind: "folder",
            name: "overlay",
            path: "widgets/overlay",
            children: [{ kind: "file", name: "index.html", path: "widgets/overlay/index.html", size: 3 }],
          },
        ],
      },
      { kind: "file", name: "manifest.json", path: "manifest.json", size: 10 },
      { kind: "file", name: "README.md", path: "README.md", size: 5 },
    ]);
  });

  test("is empty for no files", () => {
    expect(buildModuleFileTree([])).toEqual([]);
  });
});

describe("matchFunctionFile", () => {
  const files = [
    { path: "manifest.json", size: 1 },
    { path: "functions/battle.js", size: 1 },
    { path: "functions/util.js", size: 1 },
    { path: "lib/util.js", size: 1 },
  ];

  test("matches the exact path", () => {
    expect(matchFunctionFile("functions/battle.js", files)).toBe("functions/battle.js");
    expect(matchFunctionFile("./functions/battle.js", files)).toBe("functions/battle.js");
  });

  test("falls back to a unique file name", () => {
    expect(matchFunctionFile("battle.js", files)).toBe("functions/battle.js");
  });

  test("does not guess between files with the same name", () => {
    expect(matchFunctionFile("util.js", files)).toBeNull();
  });

  test("is null for no file or no match", () => {
    expect(matchFunctionFile(undefined, files)).toBeNull();
    expect(matchFunctionFile("missing.js", files)).toBeNull();
  });
});

describe("formatFileSize", () => {
  test("uses B, KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(28 * 1024)).toBe("28 KB");
    expect(formatFileSize(1.4 * 1024 * 1024)).toBe("1.4 MB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1.0 MB");
  });
});
