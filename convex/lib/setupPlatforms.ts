/**
 * The platforms offered at setup: a curated list in the `setupPlatforms`
 * table, resolved against the live marketplace. Pure, so the resolution rules
 * can be tested without a Convex runtime or a marketplace.
 */

import type { LocalEndpointSummary } from "./localEndpoints";
import type { MarketplaceImages } from "./marketplaceImages";

export interface CuratedSetupPlatform {
  marketplaceModuleId: string;
  required: boolean;
  defaultSelected: boolean;
  sortOrder: number;
  summary: string;
}

/** The marketplace fields setup shows for a platform. */
export interface SetupPlatformListing {
  id: string;
  name: string;
  description: string;
  version: string;
  category: string;
  images: MarketplaceImages;
}

export interface SetupPlatform {
  marketplaceModuleId: string;
  name: string;
  description: string;
  summary: string;
  version: string;
  category: string;
  images: MarketplaceImages;
  required: boolean;
  defaultSelected: boolean;
  /** What the module's archive declares; selecting the platform approves these. */
  permissions: string[];
  /** The archive's `local[]` endpoints, approved with the permissions. */
  localEndpoints: LocalEndpointSummary[];
}

export interface ResolvedSetupPlatforms {
  platforms: SetupPlatform[];
  /**
   * Required platforms that could not be resolved. Setup cannot finish while
   * this is non-empty, because the app depends on them.
   */
  unavailableRequired: string[];
}

/**
 * The curated platforms that the marketplace lists and whose permissions could
 * be read, in `sortOrder`. An entry that fails either is left out: without a
 * listing there is nothing to install, and without its permissions there is
 * nothing for the streamer to approve. A required entry that is left out is
 * reported, because setup must not continue without it.
 *
 * `permissionsById` holds null for a module whose archive could not be read;
 * `localEndpointsById` holds the endpoints of each archive that could.
 */
export function resolveSetupPlatforms(
  curated: readonly CuratedSetupPlatform[],
  listing: readonly SetupPlatformListing[],
  permissionsById: ReadonlyMap<string, string[] | null>,
  localEndpointsById: ReadonlyMap<string, LocalEndpointSummary[]> = new Map()
): ResolvedSetupPlatforms {
  const listingById = new Map(listing.map((entry) => [entry.id, entry]));
  const platforms: SetupPlatform[] = [];
  const unavailableRequired: string[] = [];

  for (const entry of [...curated].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const listed = listingById.get(entry.marketplaceModuleId);
    const permissions = permissionsById.get(entry.marketplaceModuleId) ?? null;
    if (!listed || permissions === null) {
      if (entry.required) {
        unavailableRequired.push(entry.marketplaceModuleId);
      }
      continue;
    }
    platforms.push({
      marketplaceModuleId: entry.marketplaceModuleId,
      name: listed.name,
      description: listed.description,
      summary: entry.summary,
      version: listed.version,
      category: listed.category,
      images: listed.images,
      required: entry.required,
      // A required platform is always selected, whatever the row says.
      defaultSelected: entry.required || entry.defaultSelected,
      permissions,
      localEndpoints: localEndpointsById.get(entry.marketplaceModuleId) ?? [],
    });
  }

  return { platforms, unavailableRequired };
}

/** Why a curated row is invalid, or null when it is valid. */
export function curatedSetupPlatformError(entry: CuratedSetupPlatform): string | null {
  if (entry.marketplaceModuleId.trim() === "") {
    return "marketplaceModuleId is required";
  }
  if (!Number.isFinite(entry.sortOrder)) {
    return "sortOrder must be a finite number";
  }
  if (entry.summary.trim() === "") {
    return "summary is required";
  }
  if (entry.required && !entry.defaultSelected) {
    return "a required platform must be selected by default";
  }
  return null;
}

/**
 * The list offered at launch. Twitch is required because the app depends on
 * it. OBS is not preselected because alternatives to it are planned.
 */
export const DEFAULT_SETUP_PLATFORMS: readonly CuratedSetupPlatform[] = [
  {
    marketplaceModuleId: "woofx3_twitch",
    required: true,
    defaultSelected: true,
    sortOrder: 10,
    summary: "Chat, alerts, stream info, moderation",
  },
  {
    marketplaceModuleId: "woofx3_obs",
    required: false,
    defaultSelected: false,
    sortOrder: 20,
    summary: "Switch scenes, show and hide sources",
  },
  {
    marketplaceModuleId: "woofx3_spotify",
    required: false,
    defaultSelected: false,
    sortOrder: 30,
    summary: "Now playing, song requests",
  },
  {
    marketplaceModuleId: "woofx3_throne",
    required: false,
    defaultSelected: false,
    sortOrder: 40,
    summary: "Wishlist gift alerts",
  },
];

/**
 * An empty curated list means the deployment was never seeded
 * (`setupPlatforms:seedDefaults`). With no required platform to enforce, a
 * choice saved against it would let setup finish without Twitch.
 */
export const NO_SETUP_PLATFORMS_MESSAGE = "No platforms are set up to choose from yet. This is a problem on our side.";

export interface ChosenSetupPlatform {
  marketplaceModuleId: string;
  name?: string;
  approvedPermissions: string[];
  approvedLocalEndpoints?: string[];
}

/**
 * Why a platform choice cannot be saved, or null when it can. Every required
 * platform must be in it, and each platform may appear once.
 */
export function setupChoiceError(
  chosen: readonly ChosenSetupPlatform[],
  requiredIds: readonly string[]
): string | null {
  const seen = new Set<string>();
  for (const platform of chosen) {
    if (seen.has(platform.marketplaceModuleId)) {
      return `${platform.marketplaceModuleId} is chosen more than once`;
    }
    seen.add(platform.marketplaceModuleId);
  }
  const missing = requiredIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return `Required platforms must be chosen: ${missing.join(", ")}`;
  }
  return null;
}
