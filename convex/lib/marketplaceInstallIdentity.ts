/**
 * Which marketplace listing an installed module is, and the key it installs
 * under.
 *
 * A module installs under `{manifest id}:{version}:{sha7}`. Barkloader
 * computes that key from the archive and refuses any other, and every edition
 * of a module shares the manifest id, so a later edition (`cozy-v2`, manifest
 * `cozy`) installs under `cozy:…` and replaces edition 1 in place. The first
 * edition's listing id is its manifest id, so its key is the one it always
 * had.
 *
 * The key therefore no longer says which listing is installed. That comes
 * from the module's install provenance: the engine records the listing and
 * edition it installed from (`marketplaceListingId`, `marketplaceEdition` on
 * `listEngineModules`), and Convex records the same for the installs it starts
 * (`marketplaceInstalls`). A module with neither falls back to the key's first
 * segment, which is right for every module installed before this: no later
 * edition could install until installs were keyed by manifest id, so every
 * such module is an edition whose listing id is its manifest id.
 *
 * No Convex imports: the dashboard reads installed listings with the same
 * functions.
 */

/** What a listing says about the module it installs. */
export interface ListingManifestRef {
  id: string;
  /** The manifest id every edition shares. Absent from a marketplace that predates editions. */
  moduleKey?: string;
}

/**
 * The manifest id a listing installs under. A marketplace that predates
 * editions sends no `moduleKey`; its listings are all first editions, whose
 * id is the manifest id.
 */
export function listingManifestId(listing: ListingManifestRef): string {
  const manifestId = listing.moduleKey?.trim();
  return manifestId ? manifestId : listing.id;
}

/** The install key barkloader accepts: `{manifest id}:{version}:{sha7}`. */
export function marketplaceInstallKey(manifestId: string, version: string, sha256: string): string {
  return `${manifestId}:${version}:${sha256.slice(0, 7)}`;
}

/** Install provenance as a `moduleRepository` row carries it. */
export interface MarketplaceProvenance {
  marketplaceListingId?: string;
  marketplaceEdition?: number;
}

/** The parts of a `moduleRepository` row this reads. */
export interface InstalledModuleRef extends MarketplaceProvenance {
  moduleKey?: string;
}

export interface InstalledListing {
  listingId: string;
  /** Installed version, from the key. Absent for a key without one. */
  version?: string;
  /** Known only from provenance. */
  edition?: number;
  /** The key's manifest id. */
  manifestId: string;
  /** Where `listingId` came from. */
  source: "provenance" | "moduleKey";
}

/**
 * The marketplace listing an installed module came from, or undefined for a
 * module with no key and no provenance.
 *
 * Provenance wins. Without it the key's first segment is the listing id: see
 * the module comment for why that holds for every module that lacks it.
 */
export function installedListing(row: InstalledModuleRef): InstalledListing | undefined {
  const [manifestId, version] = (row.moduleKey ?? "").split(":");
  const listingId = row.marketplaceListingId?.trim();
  if (listingId) {
    const result: InstalledListing = { listingId, manifestId: manifestId || listingId, source: "provenance" };
    if (version) {
      result.version = version;
    }
    if (row.marketplaceEdition !== undefined) {
      result.edition = row.marketplaceEdition;
    }
    return result;
  }
  if (!manifestId) {
    return undefined;
  }
  const result: InstalledListing = { listingId: manifestId, manifestId, source: "moduleKey" };
  if (version) {
    result.version = version;
  }
  return result;
}

/** Installed version by listing id, for marking listings installed or updatable. */
export function installedVersionsByListing(rows: readonly InstalledModuleRef[]): Map<string, string> {
  const versions = new Map<string, string>();
  for (const row of rows) {
    const installed = installedListing(row);
    if (installed?.version) {
      versions.set(installed.listingId, installed.version);
    }
  }
  return versions;
}

/**
 * The provenance a `moduleRepository` row should carry once it is under
 * `moduleKey`. Provenance belongs to one install, so it is only kept while the
 * key it was recorded for is still the row's key.
 *
 * 1. What the engine reports for the module, when it reports a listing: the
 *    engine recorded it at install time.
 * 2. What Convex recorded when it started the install of `moduleKey`.
 * 3. The row's own, if its key has not changed.
 * 4. None: the row now holds a build nobody recorded, and the key is all
 *    there is.
 */
export function resolveProvenance({
  moduleKey,
  reported,
  recorded,
  existing,
}: {
  moduleKey: string | undefined;
  reported?: MarketplaceProvenance;
  recorded?: MarketplaceProvenance | null;
  existing?: InstalledModuleRef | null;
}): MarketplaceProvenance {
  if (reported?.marketplaceListingId) {
    return pick(reported);
  }
  if (recorded?.marketplaceListingId) {
    return pick(recorded);
  }
  if (existing?.marketplaceListingId && moduleKey !== undefined && existing.moduleKey === moduleKey) {
    return pick(existing);
  }
  return { marketplaceListingId: undefined, marketplaceEdition: undefined };
}

function pick(provenance: MarketplaceProvenance): MarketplaceProvenance {
  return { marketplaceListingId: provenance.marketplaceListingId, marketplaceEdition: provenance.marketplaceEdition };
}

/**
 * Whether a later edition of `listing`'s module is installed. Installing the
 * listing would then replace that edition in place with this older one.
 * A module installed without provenance counts as edition 1.
 */
export function laterEditionInstalled(
  rows: readonly InstalledModuleRef[],
  listing: ListingManifestRef & { edition: number }
): boolean {
  const manifestId = listingManifestId(listing);
  return rows.some((row) => {
    const installed = installedListing(row);
    return (
      installed !== undefined &&
      installed.manifestId === manifestId &&
      installed.listingId !== listing.id &&
      (installed.edition ?? 1) > listing.edition
    );
  });
}

/** Whether any edition of the module `moduleId` names (a manifest or listing id) is installed. */
export function moduleInstalled(rows: readonly InstalledModuleRef[], moduleId: string): boolean {
  return rows.some((row) => {
    const installed = installedListing(row);
    return installed !== undefined && (installed.manifestId === moduleId || installed.listingId === moduleId);
  });
}
