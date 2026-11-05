// A semantic-release plugin that versions the woofx3 desktop app from the
// commits that change what it ships, and writes its notes from them alone.
// This repository also holds the Convex backend, deploy config and docs,
// which reach users without a desktop release, so their commits must neither
// bump the desktop version nor appear in its changelog.
//
// It wraps @semantic-release/commit-analyzer and
// @semantic-release/release-notes-generator, handing each the commits that
// touch a desktop path; .releaserc.json passes it their options.

import { execFileSync } from "node:child_process";
import { analyzeCommits as analyzeAll } from "@semantic-release/commit-analyzer";
import { generateNotes as generateAllNotes } from "@semantic-release/release-notes-generator";

// What the desktop build reads: the companion (host and its window), the
// dashboard it bundles (`vite build --mode desktop`, see the aliases in
// vite.config.ts) and the root build config and dependencies. A directory
// ends in "/"; anything else is one file. Must grow with vite.config.ts's
// aliases and companion/package.json's build script.
export const DESKTOP_PATHS = [
  "companion/",
  "client/",
  "shared/",
  "attached_assets/",
  "package.json",
  "bun.lockb",
  "vite.config.ts",
  "tailwind.config.ts",
  "postcss.config.js",
  "components.json",
  "tsconfig.json",
];

// companion/CHANGELOG.md is the release commit's own output, never a reason
// for a release.
const IGNORED_FILES = new Set(["companion/CHANGELOG.md"]);

export function touchesDesktop(files) {
  return files.some(
    (file) =>
      !IGNORED_FILES.has(file) &&
      DESKTOP_PATHS.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path))
  );
}

function changedFiles(hash, cwd) {
  const output = execFileSync("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", hash], {
    cwd,
    encoding: "utf8",
  });
  return output.split("\n").filter((line) => line !== "");
}

function desktopContext(context) {
  const commits = context.commits.filter((commit) => touchesDesktop(changedFiles(commit.hash, context.cwd)));
  context.logger.log("%d of %d commits change the desktop app", commits.length, context.commits.length);
  return { ...context, commits };
}

export async function analyzeCommits(pluginConfig, context) {
  return analyzeAll(pluginConfig, desktopContext(context));
}

export async function generateNotes(pluginConfig, context) {
  return generateAllNotes(pluginConfig, desktopContext(context));
}
