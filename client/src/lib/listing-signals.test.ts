import { describe, expect, test } from "bun:test";
import type { CatalogListing } from "@shared/marketplace-catalog";
import {
  authorInitials,
  bestsellerFloor,
  formatInstallCount,
  hasStats,
  isNewListing,
  listingBadge,
  listingStats,
} from "./listing-signals";

// Badges and stats are derived from the catalog rather than sent by it, so
// what is tested here is the derivation: which listing earns which ribbon, and
// what a card shows for a marketplace that counts nothing yet.

const NOW = Date.parse("2026-10-12T12:00:00Z");

function listing(overrides: Partial<CatalogListing> = {}): CatalogListing {
  return {
    id: "counter",
    type: "module",
    name: "Hype Counter",
    description: "Counts hype.",
    version: "1.0.0",
    author: "pixelforge",
    category: "Utilities",
    tags: [],
    images: {},
    tier: "public",
    credits: [],
    installCount: 0,
    weeklyInstallCount: 0,
    ratingCount: 0,
    ...overrides,
  };
}

describe("bestsellerFloor", () => {
  test("is the top decile's install count", () => {
    const counts = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    expect(bestsellerFloor(counts.map((installCount) => listing({ installCount })))).toBe(100);
  });

  test("a small catalog still has one bestseller", () => {
    // A decile of three listings rounds to nothing, and a storefront where
    // nothing is popular is not a storefront.
    expect(bestsellerFloor([listing({ installCount: 30 }), listing({ installCount: 10 })])).toBe(30);
  });

  test("is null when nothing has been installed", () => {
    // Which is the state of a marketplace with no install counting yet: no
    // listing is a bestseller, rather than every listing being one.
    expect(bestsellerFloor([listing(), listing()])).toBeNull();
    expect(bestsellerFloor([])).toBeNull();
  });
});

describe("isNewListing", () => {
  test("counts the last fortnight as new", () => {
    expect(isNewListing("2026-10-01T00:00:00Z", NOW)).toBe(true);
    expect(isNewListing("2026-09-01T00:00:00Z", NOW)).toBe(false);
  });

  test("a missing, unparseable or future date is not new", () => {
    expect(isNewListing(undefined, NOW)).toBe(false);
    expect(isNewListing("whenever", NOW)).toBe(false);
    // A clock skewed into the future would otherwise badge everything new.
    expect(isNewListing("2027-01-01T00:00:00Z", NOW)).toBe(false);
  });
});

describe("listingBadge", () => {
  const context = { bestsellerFloor: 1000, now: NOW };

  test("popularity outranks curation, which outranks recency", () => {
    const hot = listing({ installCount: 5000, featuredRank: 1, updatedAt: "2026-10-11T00:00:00Z" });
    expect(listingBadge(hot, context)).toBe("bestseller");
    const curated = listing({ installCount: 10, featuredRank: 1, updatedAt: "2026-10-11T00:00:00Z" });
    expect(listingBadge(curated, context)).toBe("staff");
    expect(listingBadge(listing({ updatedAt: "2026-10-11T00:00:00Z" }), context)).toBe("new");
  });

  test("an ordinary listing wears no ribbon", () => {
    expect(listingBadge(listing({ updatedAt: "2026-01-01T00:00:00Z" }), context)).toBeNull();
  });

  test("with no install data, popularity cannot be claimed", () => {
    const uncounted = { bestsellerFloor: null, now: NOW };
    expect(listingBadge(listing({ featuredRank: 0 }), uncounted)).toBe("staff");
  });
});

describe("formatInstallCount", () => {
  test("reads at a glance", () => {
    expect(formatInstallCount(0)).toBe("0");
    expect(formatInstallCount(980)).toBe("980");
    expect(formatInstallCount(1000)).toBe("1k");
    expect(formatInstallCount(12_400)).toBe("12.4k");
    expect(formatInstallCount(1_250_000)).toBe("1.3m");
  });
});

describe("listingStats", () => {
  test("shows the parts the marketplace has", () => {
    const stats = listingStats(listing({ rating: 4.75, ratingCount: 312, installCount: 12_400 }));
    expect(stats).toEqual({ rating: "4.8", ratingCount: "312", installs: "12.4k" });
    expect(hasStats(stats)).toBe(true);
  });

  test("installs without a rating is a complete line", () => {
    // Which is every listing until the ratings capability exists.
    const stats = listingStats(listing({ installCount: 42 }));
    expect(stats).toEqual({ installs: "42" });
    expect(hasStats(stats)).toBe(true);
  });

  test("a listing with no numbers has nothing to say", () => {
    // The card reserves the line and prints nothing in it, rather than
    // printing a zero that reads as "nobody installed this".
    expect(hasStats(listingStats(listing()))).toBe(false);
  });

  test("a rating with no count keeps the stars", () => {
    expect(listingStats(listing({ rating: 5 }))).toEqual({ rating: "5.0" });
  });
});

describe("authorInitials", () => {
  test("two letters, or a question mark when there is no name", () => {
    expect(authorInitials("pixelforge")).toBe("PI");
    expect(authorInitials("Wolfy Master")).toBe("WO");
    expect(authorInitials("")).toBe("?");
    expect(authorInitials("***")).toBe("?");
  });
});
