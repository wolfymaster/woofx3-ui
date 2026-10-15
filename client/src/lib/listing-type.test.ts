import { describe, expect, test } from "bun:test";
import { LISTING_TYPES } from "@convex/lib/marketplaceCatalog";
import { formatPrice, listingTypeColor, listingTypeHue, listingTypeMeta } from "./listing-type";

describe("listing type metadata", () => {
  test("every type has metadata, so no card can render blank", () => {
    for (const type of LISTING_TYPES) {
      const meta = listingTypeMeta(type);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.plural.length).toBeGreaterThan(0);
      expect(meta.blurb.length).toBeGreaterThan(0);
      expect(listingTypeColor(type)).toContain("oklch");
      expect(listingTypeHue(type)).toBeGreaterThanOrEqual(0);
      expect(listingTypeHue(type)).toBeLessThan(360);
    }
  });

  test("each type is a distinct hue, so the swatches tell them apart", () => {
    const colors = new Set(LISTING_TYPES.map(listingTypeColor));
    expect(colors.size).toBe(LISTING_TYPES.length);
    expect(new Set(LISTING_TYPES.map(listingTypeHue)).size).toBe(LISTING_TYPES.length);
  });
});

describe("formatPrice", () => {
  test("no price is Free, which is every listing from before commerce", () => {
    expect(formatPrice(undefined)).toBe("Free");
  });

  test("renders cents as a currency amount", () => {
    expect(formatPrice({ amountCents: 499, currency: "usd" })).toContain("4.99");
    expect(formatPrice({ amountCents: 1000, currency: "usd" })).toContain("10.00");
  });

  test("a well-formed but unfamiliar currency still formats", () => {
    // Intl accepts any three-letter code, so a currency this runtime has no
    // symbol for is rendered with the code rather than refused.
    expect(formatPrice({ amountCents: 250, currency: "zzz" })).toContain("2.50");
    expect(formatPrice({ amountCents: 250, currency: "zzz" })).toContain("ZZZ");
  });

  test("a malformed currency code falls back instead of blanking the card", () => {
    // Intl throws on these, and the catalog is a separate service -- a price
    // tag is not worth taking the whole card down for.
    for (const currency of ["", "us", "dollars"]) {
      expect(formatPrice({ amountCents: 250, currency })).toBe(`2.50 ${currency.toUpperCase()}`);
    }
  });
});
