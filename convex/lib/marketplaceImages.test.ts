import { describe, expect, it } from "bun:test";
import { featuredInOrder, parseFeaturedRank, parseMarketplaceImages } from "./marketplaceImages";

const icon = {
  sm: "https://m.example/modules/a/images/icon/h/sm.webp",
  md: "https://m.example/modules/a/images/icon/h/md.webp",
  lg: "https://m.example/modules/a/images/icon/h/lg.webp",
};
const banner = {
  card: "https://m.example/modules/a/images/banner/h/card.webp",
  hero: "https://m.example/modules/a/images/banner/h/hero.webp",
};

describe("parseMarketplaceImages", () => {
  it("keeps complete icon and banner sets", () => {
    expect(parseMarketplaceImages({ icon, banner })).toEqual({ icon, banner });
  });

  it("returns no images when the field is absent or malformed", () => {
    expect(parseMarketplaceImages(undefined)).toEqual({});
    expect(parseMarketplaceImages("nope")).toEqual({});
    expect(parseMarketplaceImages({ icon: null, banner: [] })).toEqual({});
  });

  it("drops a slot missing a size rather than rendering a broken image", () => {
    expect(parseMarketplaceImages({ icon: { sm: icon.sm, md: icon.md }, banner })).toEqual({ banner });
  });

  it("drops a slot with a non-http URL", () => {
    expect(parseMarketplaceImages({ icon: { ...icon, lg: "javascript:alert(1)" } })).toEqual({});
  });
});

describe("parseFeaturedRank", () => {
  it("accepts non-negative integers", () => {
    expect(parseFeaturedRank(0)).toBe(0);
    expect(parseFeaturedRank(7)).toBe(7);
  });

  it("treats anything else as not featured", () => {
    for (const value of [undefined, null, -1, 1.5, "2", Number.NaN]) {
      expect(parseFeaturedRank(value)).toBeUndefined();
    }
  });
});

describe("featuredInOrder", () => {
  it("keeps only featured modules, ordered by rank then name", () => {
    const modules = [
      { name: "Zeta", featuredRank: 1 },
      { name: "Plain" },
      { name: "Alpha", featuredRank: 1 },
      { name: "First", featuredRank: 0 },
    ];
    expect(featuredInOrder(modules).map((m) => m.name)).toEqual(["First", "Alpha", "Zeta"]);
  });
});
