import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import allowlist from "./boundary-allowlist.json";
import { ENGINE_NAMESPACE_MODULES } from "./namespaces";

// Biome can ban an import but not a property access, and every Convex call
// site imports the same `api` object, so the engine boundary is held by this
// test instead. It only ratchets one way: a file that stops calling engine
// modules has to leave the allowlist, so the list can only shrink.

const CLIENT_SRC = join(import.meta.dir, "..");
const SCANNED_DIRS = ["components", "pages", "hooks", "lib"];

function engineReferencePattern(): RegExp {
  const entries: readonly string[] = Object.values(ENGINE_NAMESPACE_MODULES).flat();
  const escaped = entries.map((entry) => entry.replace(".", "\\."));
  // A module entry matches `api.module.anything`; a function entry matches
  // that one function only.
  const alternatives = escaped.map((entry) => (entry.includes("\\.") ? `${entry}\\b` : `${entry}\\.`));
  return new RegExp(`\\bapi\\.(?:${alternatives.join("|")})`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function filesReferencingEngineModules(): string[] {
  const pattern = engineReferencePattern();
  return SCANNED_DIRS.flatMap((dir) => sourceFiles(join(CLIENT_SRC, dir)))
    .filter((path) => pattern.test(readFileSync(path, "utf8")))
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
}

describe("engine boundary", () => {
  const offenders = filesReferencingEngineModules();
  const allowed = new Set<string>(allowlist);

  test("only allowlisted files call engine modules outside client/src/engine", () => {
    const unexpected = offenders.filter((path) => !allowed.has(path));
    expect(unexpected, "call these through useEngineGateway() instead of api.*").toEqual([]);
  });

  test("every allowlisted file still calls an engine module", () => {
    const found = new Set(offenders);
    const clean = [...allowed].filter((path) => !found.has(path));
    expect(clean, "remove these from client/src/engine/boundary-allowlist.json").toEqual([]);
  });

  test("the allowlist is sorted and has no duplicates", () => {
    expect(allowlist).toEqual([...allowed].sort());
  });

  test("the pattern matches module and function entries", () => {
    const pattern = engineReferencePattern();
    expect(pattern.test("useAction(api.engineSync.syncNow)")).toBe(true);
    expect(pattern.test("useAction(api.macros.run)")).toBe(true);
    expect(pattern.test("useQuery(api.macros.list)")).toBe(false);
    expect(pattern.test("useQuery(api.scenesLibrary.list)")).toBe(false);
    expect(pattern.test("useQuery(api.instances.listForCurrentUser)")).toBe(false);
  });
});
