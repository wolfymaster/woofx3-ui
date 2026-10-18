/**
 * Marketplace paths.
 *
 * `/modules` still answers: it is the install surface the rest of the app
 * links to (`/modules/install`, `/modules/installed`, and the detail route an
 * install redirects onto), and breaking those links would break install
 * flows. The storefront moved to `/marketplace`, and the two storefront
 * routes under `/modules` redirect there so an old bookmark lands in the
 * right place.
 */

export const MARKETPLACE_PATH = "/marketplace";
export const MARKETPLACE_LISTING_ROUTE = "/marketplace/listing/:listingId";
export const MARKETPLACE_AUTHOR_ROUTE = "/marketplace/author/:slug";

export function marketplaceListingPath(listingId: string): string {
  return `/marketplace/listing/${encodeURIComponent(listingId)}`;
}

export function marketplaceAuthorPath(slug: string): string {
  return `/marketplace/author/${encodeURIComponent(slug)}`;
}

/**
 * Where bare `/modules?…` goes, keeping the query string.
 *
 * An integration's OAuth callback returns to `/modules?integration=…` with a
 * one-time code or an error, and only the modules page can redeem or show it,
 * so that return goes to `/modules/installed`. Anything else is an old
 * storefront link, and goes to the marketplace with its filters.
 */
export function modulesIndexRedirect(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const target = new URLSearchParams(query).has("integration") ? "/modules/installed" : MARKETPLACE_PATH;
  return query ? `${target}?${query}` : target;
}

/** The storefront filtered to one category. */
export function marketplaceCategoryPath(category: string): string {
  return category === "all" ? MARKETPLACE_PATH : `${MARKETPLACE_PATH}?category=${encodeURIComponent(category)}`;
}
