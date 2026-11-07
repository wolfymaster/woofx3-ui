import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The desktop app never shows billing, so its build must carry no /org route.
// The web and desktop builds share App.tsx, which keeps the portal out of the
// desktop build by importing it only behind the IS_DESKTOP build constant.
// This test holds that: no other file reaches into the portal.

const CLIENT_SRC = join(import.meta.dir, "..");
const PORTAL_DIR = import.meta.dir;
const APP = join(CLIENT_SRC, "App.tsx");
const PORTAL_IMPORT = /["']@\/org-portal(?:\/[^"']*)?["']|["'](?:\.\.?\/)+org-portal(?:\/[^"']*)?["']/;
const GATED_IMPORT = /IS_DESKTOP\s*\?\s*null\s*:\s*lazy\(\(\)\s*=>\s*import\(["']@\/org-portal\/OrgPortal["']\)\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("org portal build boundary", () => {
  test("only App.tsx imports the portal from outside it", () => {
    const importers = sourceFiles(CLIENT_SRC)
      .filter((file) => !file.startsWith(`${PORTAL_DIR}/`))
      .filter((file) => PORTAL_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(CLIENT_SRC, file));
    expect(importers).toEqual(["App.tsx"]);
  });

  test("App.tsx imports it only outside the desktop build, once", () => {
    const source = readFileSync(APP, "utf8");
    expect(source).toMatch(GATED_IMPORT);
    expect(source.match(new RegExp(PORTAL_IMPORT, "g"))).toHaveLength(1);
  });
});
