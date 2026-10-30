import type { CatalogListing } from "@shared/marketplace-catalog";

// The social proof on a card: how many people installed a listing, how it is
// rated, and which one-word badge it has earned.
//
// Badges are derived here rather than sent by the marketplace, because they
// are presentation: "Bestseller" means "popular relative to the listings on
// this page", which only the page knows. An explicit badge field can arrive
// later if curation needs finer control than this.

/** How long after its last update a listing still reads as new. */
const NEW_FOR_DAYS = 14;

/** The share of the most-installed listings that earn a Bestseller ribbon. */
const BESTSELLER_TOP_FRACTION = 0.1;

export type ListingBadge = "bestseller" | "new" | "staff";

export interface ListingBadgeContext {
  /**
   * The install count a listing has to reach to count as a bestseller, or null
   * when nothing on the page has been installed -- in which case nothing is a
   * bestseller, rather than everything being one.
   */
  bestsellerFloor: number | null;
  /** Now, as epoch milliseconds. Passed in so the result is testable. */
  now: number;
}

/**
 * The install count that puts a listing in the top decile of `listings`.
 *
 * Returns null when no listing has any installs, which is the state of a
 * catalog served by a marketplace that does not count them yet.
 */
export function bestsellerFloor(listings: readonly CatalogListing[]): number | null {
  const counts = listings
    .map((listing) => listing.installCount)
    .filter((count) => count > 0)
    .sort((a, b) => b - a);
  if (counts.length === 0) {
    return null;
  }
  // At least one listing always qualifies: on a small catalog a decile rounds
  // to nothing, and "nobody is popular" is not a useful storefront.
  const topCount = Math.max(1, Math.round(counts.length * BESTSELLER_TOP_FRACTION));
  return counts[topCount - 1];
}

/** Whether `updatedAt` is recent enough to badge as new. */
export function isNewListing(updatedAt: string | undefined, now: number): boolean {
  if (!updatedAt) {
    return false;
  }
  const published = Date.parse(updatedAt);
  if (Number.isNaN(published)) {
    return false;
  }
  const age = now - published;
  return age >= 0 && age <= NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * The one badge a listing wears, or null for none.
 *
 * One at a time, in buyer order: how many other streamers bought it beats who
 * curated it, which beats how recently it changed. A card with three ribbons
 * on it is a card with none.
 */
export function listingBadge(listing: CatalogListing, context: ListingBadgeContext): ListingBadge | null {
  if (context.bestsellerFloor !== null && listing.installCount >= context.bestsellerFloor) {
    return "bestseller";
  }
  if (listing.featuredRank !== undefined) {
    return "staff";
  }
  if (isNewListing(listing.updatedAt, context.now)) {
    return "new";
  }
  return null;
}

/** `12.4k`, `980`. Thousands are rounded to one decimal, trailing .0 dropped. */
export function formatInstallCount(count: number): string {
  if (count < 1000) {
    return String(Math.max(0, Math.floor(count)));
  }
  if (count < 1_000_000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** `4.8`. One decimal, so a 5 reads as 5.0 beside its neighbours. */
export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

export interface ListingStatsLine {
  rating?: string;
  ratingCount?: string;
  installs?: string;
}

/**
 * The stats line a card shows, with the parts the marketplace has no data for
 * left out.
 *
 * Returns the parts rather than a string so the stars can be coloured, and so
 * a caller can tell "no stats at all" -- which reserves the line and prints
 * nothing in it -- from "installs but no rating".
 */
export function listingStats(listing: CatalogListing): ListingStatsLine {
  const stats: ListingStatsLine = {};
  if (listing.rating !== undefined) {
    stats.rating = formatRating(listing.rating);
    if (listing.ratingCount > 0) {
      stats.ratingCount = formatInstallCount(listing.ratingCount);
    }
  }
  if (listing.installCount > 0) {
    stats.installs = formatInstallCount(listing.installCount);
  }
  return stats;
}

/** Whether a listing has any social proof to show. */
export function hasStats(stats: ListingStatsLine): boolean {
  return stats.rating !== undefined || stats.installs !== undefined;
}

/** Up to two letters for an avatar with no image behind it. */
export function authorInitials(author: string): string {
  const letters = author.replace(/[^a-z0-9]/gi, "");
  return letters === "" ? "?" : letters.slice(0, 2).toUpperCase();
}
