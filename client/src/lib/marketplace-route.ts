import { LISTING_TYPES, type ListingType } from "@shared/marketplace-catalog";

/**
 * Marketplace and module paths.
 *
 * The Marketplace tab is the storefront, and `/marketplace/upload` installs a
 * module from a zip. What is installed lives in the Stream tab's Modules group:
 * `/stream/modules` is every installed module's settings on one page, and
 * `/stream/modules/:moduleId` opens one module. The `/marketplace/installed`
 * and `/modules` paths that held them before still answer and redirect there,
 * as does a module's OAuth return (`/modules?integration=...`, which lands on
 * the settings page).
 */

export const MARKETPLACE_PATH = "/marketplace";
export const MARKETPLACE_LISTING_ROUTE = "/marketplace/listing/:listingId";
export const MARKETPLACE_AUTHOR_ROUTE = "/marketplace/author/:slug";
export const MARKETPLACE_UPLOAD_PATH = "/marketplace/upload";
export const MODULES_PATH = "/stream/modules";
export const MODULES_MODULE_ROUTE = "/stream/modules/:moduleId";
export const LEGACY_MODULES_PATH = "/modules";
export const LEGACY_MODULES_ROUTE = "/modules/:rest";
export const LEGACY_INSTALLED_PATH = "/marketplace/installed";
export const LEGACY_INSTALLED_MODULE_ROUTE = "/marketplace/installed/:rest";
/**
 * Everything that browses the catalog: the storefront, a listing and an author.
 * One route, so moving between them keeps the catalog rail mounted. It also
 * matches the upload path, so it has to be listed after it.
 */
export const MARKETPLACE_BROWSE_ROUTE = "/marketplace/*?";

export const ALL_CATEGORIES = "all";

/** What the storefront is narrowed to. The URL holds it, so it survives a reload and the back button. */
export interface MarketplaceFilter {
  type: ListingType | null;
  category: string;
  /** The whole catalog as one paged grid, rather than the front window. */
  browseAll: boolean;
}

export function parseMarketplaceFilter(search: string): MarketplaceFilter {
  const params = new URLSearchParams(search);
  return {
    // A type the storefront does not know, from a hand-edited or stale link,
    // shows the whole catalog rather than a page built around a missing type.
    type: LISTING_TYPES.find((type) => type === params.get("type")) ?? null,
    category: params.get("category") ?? ALL_CATEGORIES,
    browseAll: params.get("browse") === "all",
  };
}

export function marketplaceFilterPath({ type, category, browseAll }: MarketplaceFilter): string {
  const params = new URLSearchParams();
  if (type) {
    params.set("type", type);
  }
  if (category !== ALL_CATEGORIES) {
    params.set("category", category);
  }
  // Only when nothing else narrows the grid: a type or a category already
  // opens it, and two things saying "show the grid" can disagree.
  if (browseAll && !type && category === ALL_CATEGORIES) {
    params.set("browse", "all");
  }
  const encoded = params.toString();
  return encoded === "" ? MARKETPLACE_PATH : `${MARKETPLACE_PATH}?${encoded}`;
}

/** Whether `location` and `search` open the storefront's front window: the marketplace page with nothing narrowing it. */
export function isMarketplaceFront(location: string, search: string): boolean {
  if (location !== MARKETPLACE_PATH) {
    return false;
  }
  const filter = parseMarketplaceFilter(search);
  return filter.type === null && filter.category === ALL_CATEGORIES && !filter.browseAll;
}

export function marketplaceListingPath(listingId: string): string {
  return `/marketplace/listing/${encodeURIComponent(listingId)}`;
}

export function marketplaceAuthorPath(slug: string): string {
  return `/marketplace/author/${encodeURIComponent(slug)}`;
}

/** An installed module's page, by its module id (its bare module key) or its marketplace id. */
export function installedModulePath(moduleId: string): string {
  return `${MODULES_PATH}/${encodeURIComponent(moduleId)}`;
}

/** `path` with `search` (with or without its `?`) appended when there is one. */
function withSearch(path: string, search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return query ? `${path}?${query}` : path;
}

/**
 * Where a path under `/modules` or `/marketplace/installed` goes, keeping the query string:
 * the settings page for the bare path, the upload page for `/modules/install`, and a
 * module's page for anything else.
 */
export function legacyModulesRedirect(rest: string | undefined, search: string): string {
  if (rest === undefined || rest === "installed") {
    return withSearch(MODULES_PATH, search);
  }
  if (rest === "install") {
    return withSearch(MARKETPLACE_UPLOAD_PATH, search);
  }
  return withSearch(installedModulePath(decodeURIComponent(rest)), search);
}

/** The storefront filtered to one category. */
export function marketplaceCategoryPath(category: string): string {
  return category === ALL_CATEGORIES
    ? MARKETPLACE_PATH
    : `${MARKETPLACE_PATH}?category=${encodeURIComponent(category)}`;
}
