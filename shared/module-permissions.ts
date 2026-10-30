import { strFromU8, unzipSync } from "fflate";

/**
 * Module permissions as declared by a manifest's top-level `permissions` array.
 *
 * The engine enforces them: a module may only call a privileged capability it
 * declares, and install refuses an id it does not know. What the UI adds is
 * consent: the streamer sees what a module asks for and approves it before the
 * engine is told to install it. Nothing here grants or withholds a capability.
 */

const MANIFEST_FILE_NAME = "manifest.json";

/**
 * The permission ids a manifest declares, in declaration order, without
 * duplicates. A missing or malformed `permissions` field declares nothing,
 * matching how the engine treats a module whose manifest carries none.
 */
export function parseManifestPermissions(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const raw = (manifest as Record<string, unknown>).permissions;
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && entry.length > 0) {
      seen.add(entry);
    }
  }
  return Array.from(seen);
}

/** The ids in `requested` that `approved` does not contain, in `requested` order. */
export function unapprovedPermissions(requested: readonly string[], approved: readonly string[]): string[] {
  const approvedSet = new Set(approved);
  return requested.filter((id) => !approvedSet.has(id));
}

/**
 * The parsed manifest.json of a module archive. The shallowest manifest.json
 * wins, the rule the marketplace API and barkloader use to pick the manifest,
 * so a root manifest beats one nested in a wrapper directory or a bundled
 * dependency. Only entries named manifest.json are inflated.
 */
export function readArchiveManifest(archive: Uint8Array): Record<string, unknown> {
  const entries = unzipSync(archive, { filter: (file) => isManifestPath(file.name) });
  let bestPath: string | null = null;
  for (const path of Object.keys(entries)) {
    if (bestPath === null || pathDepth(path) < pathDepth(bestPath)) {
      bestPath = path;
    }
  }
  if (bestPath === null) {
    throw new Error(`Module archive contains no ${MANIFEST_FILE_NAME}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(entries[bestPath]));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Module archive ${bestPath} is not valid JSON: ${reason}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Module archive ${bestPath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function isManifestPath(path: string): boolean {
  return path === MANIFEST_FILE_NAME || path.endsWith(`/${MANIFEST_FILE_NAME}`);
}

function pathDepth(path: string): number {
  return path.split("/").length - 1;
}
