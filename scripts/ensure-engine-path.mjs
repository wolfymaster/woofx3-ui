#!/usr/bin/env node
/**
 * Guarantees `../woofx3` resolves to the engine repo.
 *
 * `tsconfig.json` and `vite.config.ts` both address the engine's shared
 * clients through the relative path `../woofx3/shared/clients/typescript/...`.
 * TypeScript `paths` are static — they cannot read an env var — so the only
 * way to support a layout where the engine is not a literal sibling is to
 * make one exist.
 *
 * That is what this does: if `../woofx3` is already there, nothing happens.
 * Otherwise it symlinks it to `WOOFX3_ENGINE_PATH`, and fails with a message
 * naming the variable when it cannot.
 *
 * Without it the failure is `Cannot find module '@woofx3/api/ui-schema'`,
 * which says nothing about the filesystem layout being the cause — the
 * problem is invisible precisely where a newcomer meets it, and it breaks
 * every git worktree.
 */
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const expected = path.resolve(repoRoot, "..", "woofx3");
const marker = path.join("shared", "clients", "typescript", "api", "index.ts");

function looksLikeEngine(dir) {
  return existsSync(path.join(dir, marker));
}

if (looksLikeEngine(expected)) {
  process.exit(0);
}

const configured = process.env.WOOFX3_ENGINE_PATH;
if (!configured) {
  console.error(
    [
      "",
      "  The woofx3 engine repo was not found.",
      "",
      `  Expected it at:  ${expected}`,
      "",
      "  This project addresses the engine's shared clients by relative path, so the",
      "  engine must be reachable at ../woofx3. Either clone it as a sibling of this",
      "  repo, or point WOOFX3_ENGINE_PATH at it and re-run:",
      "",
      "      WOOFX3_ENGINE_PATH=/path/to/woofx3 bun run setup",
      "",
      "  A git worktree of this repo needs this too: ../woofx3 resolves next to the",
      "  worktree, not next to the original clone.",
      "",
    ].join("\n")
  );
  process.exit(1);
}

const target = path.resolve(configured);
if (!looksLikeEngine(target)) {
  console.error(
    `\n  WOOFX3_ENGINE_PATH is set to ${target}, but that is not the woofx3 engine repo` +
      `\n  (expected to find ${marker} inside it).\n`
  );
  process.exit(1);
}

// Refuse to replace a real directory. Only ever create what is missing.
if (existsSync(expected) || lstatSync(expected, { throwIfNoEntry: false })) {
  console.error(`\n  ${expected} already exists but is not the engine repo. Not touching it.\n`);
  process.exit(1);
}

symlinkSync(target, expected, "dir");
console.log(`  linked ${expected} -> ${target}`);
