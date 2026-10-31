import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The desktop app is the companion's crate built with tauri.woofx3.conf.json
// merged over tauri.conf.json. These checks keep the two products apart: an
// identifier, version or update feed that leaks from one into the other would
// make side-by-side installs share credentials and data, or update one into
// the other.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const COMPANION_DIR = join(import.meta.dir, "..");
const REPO_DIR = join(COMPANION_DIR, "..");

function readJson(path: string): JsonObject {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** RFC 7396 JSON merge patch, the way the Tauri CLI merges `--config` files: arrays are replaced whole. */
function mergePatch(target: Json, patch: Json): Json {
  if (!isObject(patch)) {
    return patch;
  }
  const merged: JsonObject = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete merged[key];
    } else {
      merged[key] = mergePatch(merged[key] ?? null, value);
    }
  }
  return merged;
}

function at(config: Json, path: string[]): Json {
  let current: Json = config;
  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      throw new Error(`the config has no ${path.join(".")}`);
    }
    current = current[key];
  }
  return current;
}

/** The rolling release whose latest.json an updater endpoint names. */
function feedTag(config: Json): string {
  const endpoints = at(config, ["plugins", "updater", "endpoints"]);
  if (!Array.isArray(endpoints) || endpoints.length !== 1 || typeof endpoints[0] !== "string") {
    throw new Error("the updater must name exactly one endpoint");
  }
  const match = endpoints[0].match(
    /^https:\/\/github\.com\/wolfymaster\/woofx3-ui\/releases\/download\/([^/]+)\/latest\.json$/
  );
  if (!match) {
    throw new Error(`unexpected updater endpoint ${endpoints[0]}`);
  }
  return match[1];
}

/** The `LATEST_TAG` a release workflow publishes latest.json to. */
function workflowLatestTag(workflow: string): string {
  const text = readFileSync(join(REPO_DIR, ".github", "workflows", workflow), "utf8");
  const match = text.match(/^ {2}LATEST_TAG: (\S+)$/m);
  if (!match) {
    throw new Error(`${workflow} sets no LATEST_TAG`);
  }
  return match[1];
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const companion = readJson(join(COMPANION_DIR, "src-tauri", "tauri.conf.json"));
const overlay = readJson(join(COMPANION_DIR, "src-tauri", "tauri.woofx3.conf.json"));
const desktop = mergePatch(companion, overlay);

describe("the desktop app's Tauri config", () => {
  test("names a product of its own", () => {
    expect(at(desktop, ["identifier"])).toBe("tv.woofx3.app");
    expect(at(desktop, ["productName"])).toBe("woofx3");
    expect(at(companion, ["identifier"])).toBe("tv.woofx3.companion");
    expect(at(companion, ["productName"])).toBe("woofx3 companion");
  });

  test("carries its own semver version", () => {
    expect(overlay.version).toBeString();
    expect(String(overlay.version)).toMatch(SEMVER);
  });

  test("updates from its own feed, which desktop-release.yml publishes", () => {
    expect(feedTag(desktop)).toBe("desktop-latest");
    expect(workflowLatestTag("desktop-release.yml")).toBe("desktop-latest");
    expect(feedTag(companion)).toBe("companion-latest");
    expect(workflowLatestTag("companion-release.yml")).toBe("companion-latest");
  });

  test("verifies updates with the companion's updater key", () => {
    expect(at(desktop, ["plugins", "updater", "pubkey"])).toBe(at(companion, ["plugins", "updater", "pubkey"]));
    expect(at(desktop, ["plugins", "updater", "requireSignedVersion"])).toBe(true);
  });

  // The overlay repeats the window list, since a merge replaces arrays whole;
  // only the titles may differ from the companion's.
  test("has the companion's windows, retitled", () => {
    const untitled = (config: Json) => {
      const windows = at(config, ["app", "windows"]);
      if (!Array.isArray(windows)) {
        throw new Error("app.windows is not a list");
      }
      return windows.map((window) => (isObject(window) ? { ...window, title: null } : window));
    };
    expect(untitled(desktop)).toEqual(untitled(companion));
  });

  test("bundles the engine", () => {
    expect(at(desktop, ["bundle", "resources"])).toEqual(["engine/"]);
  });
});
