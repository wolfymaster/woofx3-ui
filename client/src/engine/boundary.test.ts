import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
// types.
const CONVEX_MODULE = /^(?:@convex\/|convex(?:\/|$)|(?:\.\.\/){3,}convex\/)/;
const CONVEX_GENERATED_TYPE = /\b(?:Id|Doc|FunctionReturnType|FunctionArgs)</;

// Engine code reaches the instance through useEngineScope(), so no gateway
// depends on how the Convex adapter learns which instance is selected. Only
// the boot wiring picks the adapter and feeds it the selected instance.
const BOOT_WIRING = join(ENGINE_DIR, "context.tsx");
const INSTANCE_SELECTION = join(CLIENT_SRC, "hooks", "use-instance");

// Outside client/src/engine, screens reach the engine through the gateway's
// own ids. Cloud-only features keyed by Convex rows convert through this one
// module, which names each conversion they need.
const CLOUD_ID_CONVERSIONS = join(CLIENT_SRC, "lib", "cloud-ids.ts");

// The live transport is the Convex gateway's realtime half: it opens the
// engine socket with the credentials Convex recorded, so a screen or engine
// hook that imported it would bypass whichever gateway the app booted with.
const TRANSPORT_DIR = join(CLIENT_SRC, "lib", "transport");

// `from "x"`, `import "x"` and `import("x")`, static or type-only.
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]);
}

/** The path a specifier names, for the `@/` alias and relative paths; null for packages. */
function resolveSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) {
    return join(CLIENT_SRC, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return resolve(dirname(file), specifier);
  }
  return null;
}

function isWithin(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

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
  const imports = importSpecifiers(source).filter((specifier) => CONVEX_MODULE.test(specifier));
  return [...imports, ...(source.match(CONVEX_GENERATED_TYPE) ?? [])];
}

/** What a file in client/src/engine imports that only the boot wiring may. */
function bootOnlyImports(file: string, source: string): string[] {
  return importSpecifiers(source).filter((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return target !== null && (isWithin(target, CONVEX_ADAPTER_DIR) || target === INSTANCE_SELECTION);
  });
}

function engineFilesOutsideAdapter(): string[] {
  // This file spells the patterns out in its own cases.
  return sourceFiles(ENGINE_DIR).filter((path) => path !== import.meta.path && !isWithin(path, CONVEX_ADAPTER_DIR));
}

function engineFilesNamingConvex(): string[] {
  return engineFilesOutsideAdapter()
    .filter((path) => convexLeaks(readFileSync(path, "utf8")).length > 0)
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
}

function engineFilesReachingBootDependencies(): string[] {
  return engineFilesOutsideAdapter()
    .filter((path) => path !== BOOT_WIRING)
    .filter((path) => bootOnlyImports(path, readFileSync(path, "utf8")).length > 0)
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
}

/** What a file imports from the Convex adapter. */
function adapterImports(file: string, source: string): string[] {
  return importSpecifiers(source).filter((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return target !== null && isWithin(target, CONVEX_ADAPTER_DIR);
  });
}

function appFilesReachingAdapter(): string[] {
  return sourceFiles(CLIENT_SRC)
    .filter((path) => !isWithin(path, ENGINE_DIR) && path !== CLOUD_ID_CONVERSIONS)
    .filter((path) => adapterImports(path, readFileSync(path, "utf8")).length > 0)
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
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
    expect(convexLeaks('import "convex/browser";')).not.toEqual([]);
    expect(convexLeaks('type Row = Doc<"scenes">;')).not.toEqual([]);
    expect(convexLeaks("type Out = FunctionReturnType<typeof list>;")).not.toEqual([]);
    expect(convexLeaks('import { convexEngineGateway } from "@/engine/convex/gateway";')).toEqual([]);
    expect(convexLeaks("type Id = InstanceId;")).toEqual([]);
  });

  test("only the boot wiring in client/src/engine reaches the Convex adapter or the instance selection", () => {
    expect(engineFilesReachingBootDependencies(), "read the instance with useEngineScope() instead").toEqual([]);
  });

  test("the boot-only check matches the adapter and the instance selection", () => {
    const file = join(ENGINE_DIR, "hooks", "use-example.ts");
    expect(bootOnlyImports(file, 'import { toInstanceId } from "@/engine/convex/ids";')).not.toEqual([]);
    expect(bootOnlyImports(file, 'import { toInstanceId } from "../convex/ids";')).not.toEqual([]);
    expect(bootOnlyImports(file, 'import { useInstance } from "@/hooks/use-instance";')).not.toEqual([]);
    expect(bootOnlyImports(file, 'import { useEngineScope } from "@/engine/context";')).toEqual([]);
    expect(bootOnlyImports(file, 'import { useInstanceSwitcher } from "@/hooks/use-instance-switcher";')).toEqual([]);
  });
});

describe("engine adapter boundary", () => {
  // Read while the tests are collected, like the engine boundary's offenders,
  // so a slow disk does not run into a test's timeout.
  const reachingAdapter = appFilesReachingAdapter();

  test("outside client/src/engine only lib/cloud-ids.ts reaches the Convex adapter", () => {
    expect(reachingAdapter, "take the instance from useEngineScope(), or convert in lib/cloud-ids.ts").toEqual([]);
  });

  test("the adapter check matches aliased and relative imports", () => {
    const file = join(CLIENT_SRC, "components", "example.tsx");
    expect(adapterImports(file, 'import { toInstanceId } from "@/engine/convex/ids";')).not.toEqual([]);
    expect(adapterImports(file, 'import { toInstanceId } from "../engine/convex/ids";')).not.toEqual([]);
    expect(adapterImports(file, 'import { useEngineScope } from "@/engine/context";')).toEqual([]);
    expect(adapterImports(file, 'import { api } from "@convex/_generated/api";')).toEqual([]);
  });
});

/** What a file imports from the live transport. */
function transportImports(file: string, source: string): string[] {
  return importSpecifiers(source).filter((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return target !== null && isWithin(target, TRANSPORT_DIR);
  });
}

/** Whether a file may import the live transport: only the Convex adapter and the transport itself. */
function mayImportTransport(path: string): boolean {
  return isWithin(path, CONVEX_ADAPTER_DIR) || isWithin(path, TRANSPORT_DIR);
}

function filesReachingTransport(): string[] {
  return sourceFiles(CLIENT_SRC)
    .filter((path) => path !== import.meta.path && !mayImportTransport(path))
    .filter((path) => transportImports(path, readFileSync(path, "utf8")).length > 0)
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
}

describe("live transport boundary", () => {
  const reachingTransport = filesReachingTransport();

  test("only the Convex adapter imports the live transport", () => {
    expect(reachingTransport, "go through useEngineGateway() instead of @/lib/transport").toEqual([]);
  });

  test("the adapter and the transport may import it; engine hooks and screens may not", () => {
    expect(mayImportTransport(join(CONVEX_ADAPTER_DIR, "session.ts"))).toBe(true);
    expect(mayImportTransport(join(TRANSPORT_DIR, "browser-transport.ts"))).toBe(true);
    expect(mayImportTransport(join(ENGINE_DIR, "hooks", "use-event-log.ts"))).toBe(false);
    expect(mayImportTransport(join(ENGINE_DIR, "types.ts"))).toBe(false);
    expect(mayImportTransport(join(CLIENT_SRC, "components", "dashboard", "widgets", "stream-stats.tsx"))).toBe(false);
  });

  test("the transport check matches aliased, relative and deep imports", () => {
    const file = join(CLIENT_SRC, "components", "dashboard", "widgets", "example.tsx");
    expect(transportImports(file, 'import { transport } from "@/lib/transport";')).not.toEqual([]);
    expect(transportImports(file, 'import { $engineConnected } from "@/lib/transport/engine-connection";')).not.toEqual(
      []
    );
    expect(transportImports(file, 'import { transport } from "../../../lib/transport";')).not.toEqual([]);
    expect(transportImports(file, 'import type { WorkflowRun } from "@/lib/transport/interface";')).not.toEqual([]);
    expect(
      transportImports(file, 'import { useStreamEventsSubscription } from "@/engine/hooks/use-event-log";')
    ).toEqual([]);
    expect(transportImports(file, 'import { transportLabel } from "@/lib/transport-labels";')).toEqual([]);
  });
});

// The direct adapter drives the engine itself, with no Convex behind it, so
// it and the live session it runs on must not know a backend exists. Only the
// boot wiring picks it, as it picks the Convex adapter, and TanStack Query is
// its cache alone: a screen that used it would cache outside the gateway.
const DIRECT_ADAPTER_DIR = join(ENGINE_DIR, "direct");
const ENGINE_SESSION_DIR = join(CLIENT_SRC, "lib", "engine-session");
const TANSTACK_QUERY = /^@tanstack\/react-query(?:\/|$)/;

/** What a file of the direct adapter or the live session imports from a backend, or from the Convex adapter's own inputs. */
function directLeaks(file: string, source: string): string[] {
  const reaching = importSpecifiers(source).filter((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return (
      target !== null &&
      (isWithin(target, CONVEX_ADAPTER_DIR) || isWithin(target, TRANSPORT_DIR) || target === INSTANCE_SELECTION)
    );
  });
  return [...convexLeaks(source), ...reaching];
}

/** What a file imports from the direct adapter. */
function directAdapterImports(file: string, source: string): string[] {
  return importSpecifiers(source).filter((specifier) => {
    const target = resolveSpecifier(file, specifier);
    return target !== null && isWithin(target, DIRECT_ADAPTER_DIR);
  });
}

function tanstackQueryImports(source: string): string[] {
  return importSpecifiers(source).filter((specifier) => TANSTACK_QUERY.test(specifier));
}

function offenders(files: string[], leaks: (file: string, source: string) => string[]): string[] {
  return files
    .filter((path) => path !== import.meta.path)
    .filter((path) => leaks(path, readFileSync(path, "utf8")).length > 0)
    .map((path) => relative(CLIENT_SRC, path))
    .sort();
}

describe("direct adapter boundary", () => {
  const appFiles = sourceFiles(CLIENT_SRC).filter((path) => !isWithin(path, DIRECT_ADAPTER_DIR));
  const leakingBackend = offenders(
    [...sourceFiles(DIRECT_ADAPTER_DIR), ...sourceFiles(ENGINE_SESSION_DIR)],
    directLeaks
  );
  const reachingDirect = offenders(
    appFiles.filter((path) => path !== BOOT_WIRING),
    directAdapterImports
  );
  const usingTanstack = offenders(appFiles, (_file, source) => tanstackQueryImports(source));
  const convexReachingDirect = offenders(sourceFiles(CONVEX_ADAPTER_DIR), directAdapterImports);

  test("the direct adapter and the live session import no backend", () => {
    expect(leakingBackend, "map through @/engine/types; never import Convex, its adapter or the transport").toEqual([]);
  });

  test("outside client/src/engine/direct only the boot wiring reaches the direct adapter", () => {
    expect(reachingDirect, "go through useEngineGateway() instead of @/engine/direct").toEqual([]);
  });

  test("only the direct adapter imports TanStack Query", () => {
    expect(usingTanstack, "read through the engine gateway instead of caching beside it").toEqual([]);
  });

  test("the Convex adapter does not import the direct adapter", () => {
    expect(convexReachingDirect, "share code through @/engine or @/lib instead").toEqual([]);
  });

  test("the backend check matches Convex, its adapter, the transport and the instance selection", () => {
    const file = join(DIRECT_ADAPTER_DIR, "example.ts");
    expect(directLeaks(file, 'import { api } from "@convex/_generated/api";')).not.toEqual([]);
    expect(directLeaks(file, 'import { toInstanceId } from "../convex/ids";')).not.toEqual([]);
    expect(directLeaks(file, 'import { transport } from "@/lib/transport";')).not.toEqual([]);
    expect(directLeaks(file, 'import { transport } from "../../lib/transport/browser-transport";')).not.toEqual([]);
    expect(directLeaks(file, 'import { useInstance } from "@/hooks/use-instance";')).not.toEqual([]);
    expect(directLeaks(file, 'import { EngineSession } from "@/lib/engine-session/EngineSession";')).toEqual([]);
    expect(directLeaks(file, 'import type { TransientEvent } from "@/engine/types";')).toEqual([]);
  });

  test("the direct adapter check matches aliased, relative and deep imports", () => {
    const file = join(CLIENT_SRC, "components", "dashboard", "example.tsx");
    expect(directAdapterImports(file, 'import { x } from "@/engine/direct/connection";')).not.toEqual([]);
    expect(directAdapterImports(file, 'import { x } from "../../engine/direct";')).not.toEqual([]);
    expect(directAdapterImports(file, 'import type { X } from "@/engine/direct/testing/x";')).not.toEqual([]);
    expect(directAdapterImports(file, 'import { useEngineScope } from "@/engine/context";')).toEqual([]);
    expect(directAdapterImports(file, 'import { x } from "@/engine/directory";')).toEqual([]);
  });

  test("the TanStack check matches the package and its subpaths only", () => {
    expect(tanstackQueryImports('import { useQuery } from "@tanstack/react-query";')).not.toEqual([]);
    expect(tanstackQueryImports('import type { QueryKey } from "@tanstack/react-query/build/modern";')).not.toEqual([]);
    expect(tanstackQueryImports('import { useVirtualizer } from "@tanstack/react-virtual";')).toEqual([]);
    expect(tanstackQueryImports('import { useQuery } from "convex/react";')).toEqual([]);
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
