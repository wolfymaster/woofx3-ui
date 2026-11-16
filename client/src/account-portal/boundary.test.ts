import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The desktop app never shows billing, so its build must carry no /account route.
// The web and desktop builds share App.tsx, which keeps the portal out of the
// desktop build by importing it only behind the IS_DESKTOP build constant.
// This test holds that: no other file reaches into the portal. The sponsor
// confirm screen at /sponsor/start is kept out of the desktop build the same way.

const CLIENT_SRC = join(import.meta.dir, "..");
const PORTAL_DIR = import.meta.dir;
const APP = join(CLIENT_SRC, "App.tsx");
const PORTAL_IMPORT = /["']@\/account-portal(?:\/[^"']*)?["']|["'](?:\.\.?\/)+account-portal(?:\/[^"']*)?["']/;
const GATED_IMPORT =
  /IS_DESKTOP\s*\?\s*null\s*:\s*lazy\(\(\)\s*=>\s*import\(["']@\/account-portal\/AccountPortal["']\)\)/;

const SPONSOR_START_IMPORT = /["']@\/sponsorship\/SponsorStart["']|["'](?:\.\.?\/)+sponsorship\/SponsorStart["']/;
const GATED_SPONSOR_START_IMPORT =
  /IS_DESKTOP\s*\?\s*null\s*:\s*lazy\(\(\)\s*=>\s*import\(["']@\/sponsorship\/SponsorStart["']\)\)/;

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

  test("the route matches /account and its subpaths only", () => {
    const route = readFileSync(APP, "utf8").match(/const ACCOUNT_PORTAL_ROUTE = (\/.*\/);/);
    expect(route).not.toBeNull();
    const pattern = new RegExp(route?.[1].slice(1, -1) ?? "");
    expect(pattern.test("/account")).toBe(true);
    expect(pattern.test("/account/payments")).toBe(true);
    expect(pattern.test("/org")).toBe(false);
    expect(pattern.test("/accounts")).toBe(false);
  });

  test("App.tsx imports it only outside the desktop build, once", () => {
    const source = readFileSync(APP, "utf8");
    expect(source).toMatch(GATED_IMPORT);
    expect(source.match(new RegExp(PORTAL_IMPORT, "g"))).toHaveLength(1);
  });

  test("only App.tsx imports the sponsor confirm screen, outside the desktop build, once", () => {
    const importers = sourceFiles(CLIENT_SRC)
      .filter((file) => SPONSOR_START_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(CLIENT_SRC, file));
    expect(importers).toEqual(["App.tsx"]);
    const source = readFileSync(APP, "utf8");
    expect(source).toMatch(GATED_SPONSOR_START_IMPORT);
    expect(source.match(new RegExp(SPONSOR_START_IMPORT, "g"))).toHaveLength(1);
  });
});
