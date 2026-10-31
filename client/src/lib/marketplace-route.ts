import { LISTING_TYPES, type ListingType } from "@shared/marketplace-catalog";

/**
 * Marketplace paths.
 *
 * The Marketplace tab is both the storefront and the place to see and manage
 * what is installed: `/marketplace/installed` lists the installed modules,
 * `/marketplace/installed/:moduleId` opens one, and `/marketplace/upload`
 * installs a module from a zip. The `/modules` paths that came before them
 * still answer and redirect here, since bookmarks, getting-started links and
 * a module's OAuth return still use them.
 */

export const MARKETPLACE_PATH = "/marketplace";
export const MARKETPLACE_LISTING_ROUTE = "/marketplace/listing/:listingId";
export const MARKETPLACE_AUTHOR_ROUTE = "/marketplace/author/:slug";
export const MARKETPLACE_INSTALLED_PATH = "/marketplace/installed";
export const MARKETPLACE_INSTALLED_MODULE_ROUTE = "/marketplace/installed/:moduleId";
export const MARKETPLACE_UPLOAD_PATH = "/marketplace/upload";
/**
 * Everything that browses the catalog: the storefront, a listing and an author.
 * One route, so moving between them keeps the catalog rail mounted. It also
 * matches the installed and upload paths, so it has to be listed after them.
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

export function marketplaceListingPath(listingId: string): string {
  return `/marketplace/listing/${encodeURIComponent(listingId)}`;
}

export function marketplaceAuthorPath(slug: string): string {
  return `/marketplace/author/${encodeURIComponent(slug)}`;
}

/** An installed module's page, by its module id (its bare module key) or its marketplace id. */
export function installedModulePath(moduleId: string): string {
  return `${MARKETPLACE_INSTALLED_PATH}/${encodeURIComponent(moduleId)}`;
}

/** `path` with `search` (with or without its `?`) appended when there is one. */
function withSearch(path: string, search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return query ? `${path}?${query}` : path;
}

/**
 * Where bare `/modules?…` goes, keeping the query string.
 *
 * An integration's OAuth callback returns to `/modules?integration=…` with a
 * one-time code or an error, and only the installed modules page can redeem or
 * show it, so that return goes there. Anything else is an old storefront link,
 * and goes to the marketplace with its filters.
 */
export function modulesIndexRedirect(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const target = new URLSearchParams(query).has("integration") ? MARKETPLACE_INSTALLED_PATH : MARKETPLACE_PATH;
  return withSearch(target, query);
}

/** Where an old `/modules/…` path goes, keeping the query string. */
export function legacyModulesRedirect(rest: string, search: string): string {
  if (rest === "install") {
    return withSearch(MARKETPLACE_UPLOAD_PATH, search);
  }
  if (rest === "installed") {
    return withSearch(MARKETPLACE_INSTALLED_PATH, search);
  }
  return withSearch(installedModulePath(decodeURIComponent(rest)), search);
}

/** The storefront filtered to one category. */
export function marketplaceCategoryPath(category: string): string {
  return category === ALL_CATEGORIES
    ? MARKETPLACE_PATH
    : `${MARKETPLACE_PATH}?category=${encodeURIComponent(category)}`;
}
