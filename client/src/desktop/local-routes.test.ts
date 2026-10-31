import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { MARKETPLACE_PATH } from "@/lib/marketplace-route";
import { LOCAL_HOME_PATH, LOCAL_ROUTES, servesLocally } from "./local-routes";

// Local mode runs with no Convex client, so nothing it loads may reach one: a
// Convex hook there throws for want of a provider. This walks every import
// from local mode's entry, static and dynamic, through the app's path
// aliases, and fails on any that reaches Convex.

const CLIENT_SRC = join(import.meta.dir, "..");
const REPO = join(CLIENT_SRC, "..", "..");

/**
 * What local mode cannot load: Convex's client and hooks, its generated API,
 * the hosted wiring built on them, and Convex's HTTP site, whose URLs (macro
 * trigger URLs, overlay links) a lone engine has none of.
 */
const CONVEX_REACHING: readonly RegExp[] = [
  /^convex\/react$/,
  /^@convex-dev\/auth\//,
  /^@convex\/_generated\//,
  /^convex\/browser$/,
];
const CONVEX_REACHING_FILES: readonly string[] = [
  join(CLIENT_SRC, "lib", "convexClient.ts"),
  join(CLIENT_SRC, "lib", "convexSiteUrl.ts"),
  join(CLIENT_SRC, "hooks", "use-instance.ts"),
  join(CLIENT_SRC, "engine", "boot", "hosted.tsx"),
  join(CLIENT_SRC, "engine", "convex"),
];

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const transpilers = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };

function resolveFile(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) {
    return base;
  }
  for (const extension of EXTENSIONS) {
    if (existsSync(base + extension)) {
      return base + extension;
    }
  }
  return null;
}

/** The file a specifier names in this repo, or null for a package. */
function resolve(from: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return resolveFile(join(CLIENT_SRC, specifier.slice(2)));
  }
  if (specifier.startsWith("@shared/")) {
    return resolveFile(join(REPO, "shared", specifier.slice(8)));
  }
  if (specifier.startsWith("@convex/")) {
    return resolveFile(join(REPO, "convex", specifier.slice(8)));
  }
  if (specifier.startsWith(".")) {
    return resolveFile(join(dirname(from), specifier));
  }
  return null;
}

/**
 * Each path from `entry` to something Convex-reaching, as the chain of files
 * (relative to the repo) that leads there. Empty when nothing does.
 */
function convexPaths(entry: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) {
      return;
    }
    seen.add(file);
    const here = [...chain, relative(REPO, file)];
    if (CONVEX_REACHING_FILES.some((blocked) => file === blocked || file.startsWith(`${blocked}/`))) {
      found.push(here.join(" -> "));
      return;
    }
    const source = readFileSync(file, "utf8");
    const transpiler = file.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const { path: specifier } of transpiler.scanImports(source)) {
      if (CONVEX_REACHING.some((pattern) => pattern.test(specifier))) {
        found.push([...here, specifier].join(" -> "));
        continue;
      }
      const next = resolve(file, specifier);
      if (next !== null) {
        walk(next, here);
      }
    }
  };
  walk(entry, []);
  return found;
}

describe("local mode", () => {
  test("loads nothing that reaches Convex", () => {
    expect(convexPaths(join(import.meta.dir, "LocalApp.tsx"))).toEqual([]);
  });

  test("the check finds a page that reaches Convex", () => {
    expect(convexPaths(join(CLIENT_SRC, "pages", "team.tsx"))).not.toEqual([]);
  });

  test("its home is a page it serves", () => {
    expect(servesLocally(LOCAL_HOME_PATH)).toBe(true);
    expect(new Set(LOCAL_ROUTES.map((route) => route.path)).size).toBe(LOCAL_ROUTES.length);
  });

  test("the marketplace link survives being served by the browse route", () => {
    expect(servesLocally(MARKETPLACE_PATH)).toBe(true);
  });
});
