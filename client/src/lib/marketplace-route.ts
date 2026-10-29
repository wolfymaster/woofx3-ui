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
  return category === "all" ? MARKETPLACE_PATH : `${MARKETPLACE_PATH}?category=${encodeURIComponent(category)}`;
}
