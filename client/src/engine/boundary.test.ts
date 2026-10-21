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
const ENGINE_DIR = import.meta.dir;
const CONVEX_ADAPTER_DIR = join(ENGINE_DIR, "convex");

// The gateway's interface and types have to be implementable without Convex,
// so only the Convex adapter may import Convex modules or name its generated
// types. Reaching the adapter itself (`@/engine/convex/...`) is how the app
// wires it in, and stays allowed.
const CONVEX_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*)["'](?:@convex\/|convex(?:\/|["'])|(?:\.\.\/){3,}convex\/)/;
const CONVEX_GENERATED_TYPE = /\b(?:Id|Doc|FunctionReturnType|FunctionArgs)</;

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

function convexLeaks(source: string): string[] {
  return [CONVEX_IMPORT, CONVEX_GENERATED_TYPE].flatMap((pattern) => source.match(pattern) ?? []);
}

function engineFilesNamingConvex(): string[] {
  return (
    sourceFiles(ENGINE_DIR)
      // This file spells the patterns out in its own cases.
      .filter((path) => path !== import.meta.path && !path.startsWith(`${CONVEX_ADAPTER_DIR}/`))
      .filter((path) => convexLeaks(readFileSync(path, "utf8")).length > 0)
      .map((path) => relative(CLIENT_SRC, path))
      .sort()
  );
}

describe("engine gateway types", () => {
  test("only the Convex adapter in client/src/engine imports Convex or names its generated types", () => {
    expect(engineFilesNamingConvex(), "map Convex shapes into @/engine/types inside client/src/engine/convex").toEqual(
      []
    );
  });

  test("the Convex check matches imports and generated types", () => {
    expect(convexLeaks('import type { Id } from "@convex/_generated/dataModel";')).not.toEqual([]);
    expect(convexLeaks('import { useQuery } from "convex/react";')).not.toEqual([]);
    expect(convexLeaks('import type { Report } from "../../../convex/lib/report";')).not.toEqual([]);
    expect(convexLeaks('type Report = import("@convex/lib/report").Report;')).not.toEqual([]);
    expect(convexLeaks('type Row = Doc<"scenes">;')).not.toEqual([]);
    expect(convexLeaks("type Out = FunctionReturnType<typeof list>;")).not.toEqual([]);
    expect(convexLeaks('import { convexEngineGateway } from "@/engine/convex/gateway";')).toEqual([]);
    expect(convexLeaks("type Id = InstanceId;")).toEqual([]);
  });
});

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
    expect(pattern.test("useAction(api.marketplace.installModule)")).toBe(true);
    expect(pattern.test("useAction(api.marketplace.listModules)")).toBe(false);
    expect(pattern.test("useQuery(api.scenesLibrary.list)")).toBe(false);
    expect(pattern.test("useQuery(api.instances.listForCurrentUser)")).toBe(false);
  });
});
