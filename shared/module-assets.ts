// The files a module ships for its actions' `asset` fields, as an asset
// picker lists them. Pure, so the Convex gateway (from the rows it keeps of
// the engine's `module.asset.registered`) and the direct gateway (from the
// installed manifest) answer the same list.

export interface ModuleAssetOption {
  /** `{moduleId}:asset:{manifestId}`: the value an `asset` field stores. */
  canonicalId: string;
  name: string;
  /** The manifest's broad-category hint (`image`, `audio`, ...), when it gives one. */
  kind?: string;
  description?: string;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The assets a manifest declares in `assets[]`, with the canonical ids the
 * engine registers them under. Entries without an id or a name are skipped,
 * as the engine refuses them at install.
 */
export function manifestAssets(manifest: unknown, moduleId: string): ModuleAssetOption[] {
  if (!manifest || typeof manifest !== "object") {
    return [];
  }
  const assets = (manifest as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) {
    return [];
  }
  return assets.flatMap((entry): ModuleAssetOption[] => {
    const o = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const id = nonEmpty(o.id);
    const name = nonEmpty(o.name);
    if (!id || !name) {
      return [];
    }
    const kind = nonEmpty(o.kind);
    const description = nonEmpty(o.description);
    return [
      {
        canonicalId: `${moduleId}:asset:${id}`,
        name,
        ...(kind ? { kind } : {}),
        ...(description ? { description } : {}),
      },
    ];
  });
}

/**
 * The assets a field offers: those of the given kinds (all when none are
 * given; an asset with no kind matches only then), ordered by name.
 */
export function assetsOfKinds<Asset extends { name: string; kind?: string }>(
  assets: readonly Asset[],
  kinds: readonly string[] | undefined
): Asset[] {
  const wanted = kinds && kinds.length > 0 ? new Set(kinds) : null;
  return assets
    .filter((asset) => wanted === null || (asset.kind !== undefined && wanted.has(asset.kind)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
