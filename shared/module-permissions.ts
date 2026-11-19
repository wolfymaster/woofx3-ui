/**
 * Module permissions as declared by a manifest's top-level `permissions` array.
 *
 * The engine enforces them: a module may only call a privileged capability it
 * declares, and install refuses an id it does not know. What the UI adds is
 * consent: the streamer sees what a module asks for and approves it before the
 * engine is told to install it. Nothing here grants or withholds a capability.
 */

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
