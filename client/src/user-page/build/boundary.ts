import { isAbsolute, relative, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * The public user page is downloaded by anyone who opens a streamer's page,
 * so its bundle holds only what that page needs: its own code, the user-page
 * registry and the value readers it shares with the dashboard. The signed-in
 * dashboard (auth, the shell, the engine gateway and its transport) and the
 * engine's shared clients never reach it.
 *
 * Repository paths, with "/" separators; an entry ending in "/" is a directory.
 * Anything else in the repository is refused, so a new dependency is a
 * deliberate addition here rather than something an import drags in.
 */
export const USER_PAGE_LOCAL_MODULES: readonly string[] = [
  "client/src/user-page/",
  "client/src/lib/resource-values.ts",
  "shared/user-pages/",
  "convex/_generated/api.js",
  "convex/lib/resourceKinds.ts",
  // Web Crypto only: the sign-in nonce has to be the token shape Convex checks.
  "convex/lib/oauthHandoff.ts",
];

/** Packages that exist for signing in, the engine connection or the desktop app. */
export const USER_PAGE_DENIED_PACKAGES: readonly string[] = [
  "@convex-dev/auth",
  "@tanstack/react-query",
  "@tauri-apps/api",
  "capnweb",
  "nanostores",
  "@nanostores/react",
];

const NODE_MODULES = "/node_modules/";

/** The package a module inside node_modules belongs to, scoped names included. */
function packageName(path: string): string {
  const after = path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
  const parts = after.split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * Why the module Rollup knows as `moduleId` may not be in the user page
 * bundle, or null when it may. Virtual modules (Vite's own helpers, ids
 * starting with a NUL byte) are always allowed.
 */
export function userPageBoundaryViolation(moduleId: string, repoRoot: string): string | null {
  if (moduleId.startsWith("\0")) {
    return null;
  }
  const file = moduleId.split("?")[0];
  const path = file.split(sep).join("/");
  if (path.includes(NODE_MODULES)) {
    const name = packageName(path);
    return USER_PAGE_DENIED_PACKAGES.includes(name) ? `the package ${name}` : null;
  }
  if (!isAbsolute(file)) {
    return `${moduleId}, which is not a file`;
  }
  const repoPath = relative(repoRoot, file).split(sep).join("/");
  if (repoPath.startsWith("../")) {
    return `${path}, outside this repository`;
  }
  const allowed = USER_PAGE_LOCAL_MODULES.some((entry) =>
    entry.endsWith("/") ? repoPath.startsWith(entry) : repoPath === entry
  );
  return allowed ? null : repoPath;
}

/**
 * Fails the user page build when its module graph reaches anything
 * `userPageBoundaryViolation` refuses, naming what imported it. It checks the
 * graph Rollup actually bundled, so type-only imports, which ship nothing, are
 * not counted.
 */
export function userPageBoundary(repoRoot: string): Plugin {
  return {
    name: "woofx3:user-page-boundary",
    apply: "build",
    buildEnd(error) {
      if (error) {
        return;
      }
      // Keyed by violation, so a refused package is named once with whatever
      // outside it imported it, not once per file inside it.
      const importersByViolation = new Map<string, Set<string>>();
      for (const id of this.getModuleIds()) {
        const violation = userPageBoundaryViolation(id, repoRoot);
        if (violation === null) {
          continue;
        }
        const importers = importersByViolation.get(violation) ?? new Set<string>();
        for (const importer of this.getModuleInfo(id)?.importers ?? []) {
          if (userPageBoundaryViolation(importer, repoRoot) !== violation) {
            importers.add(relative(repoRoot, importer));
          }
        }
        importersByViolation.set(violation, importers);
      }
      const problems = [...importersByViolation].map(([violation, importers]) =>
        importers.size > 0 ? `  ${violation} (imported by ${[...importers].join(", ")})` : `  ${violation}`
      );
      if (problems.length > 0) {
        this.error(
          `The user page may not bundle:\n${problems.join("\n")}\n` +
            "It is public; see USER_PAGE_LOCAL_MODULES in client/src/user-page/build/boundary.ts."
        );
      }
    },
  };
}
