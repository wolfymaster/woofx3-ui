/**
 * Module images and featured placement as the marketplace API returns them.
 *
 * The marketplace renders every image into fixed sizes and serves each at a
 * content-hashed URL, so these URLs are stable and safe to cache. Sizes are
 * named for where they are shown; the pixel dimensions must match `slotSizes`
 * in woofx3-marketplace-api's internal/httpapi/images.go.
 */

/** Square icon renditions: 64, 128 and 256 px. */
export interface MarketplaceIconUrls {
  sm: string;
  md: string;
  lg: string;
}

/** Banner renditions: card is 512×224, hero is 1600×512. */
export interface MarketplaceBannerUrls {
  card: string;
  hero: string;
}

export interface MarketplaceImages {
  icon?: MarketplaceIconUrls;
  banner?: MarketplaceBannerUrls;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.startsWith("https://") || value.startsWith("http://") ? value : null;
}

/** Every named size as an http(s) URL, or null when any is missing. */
function sizeUrls<K extends string>(value: unknown, sizes: readonly K[]): Record<K, string> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const size of sizes) {
    const url = httpUrl(obj[size]);
    if (!url) {
      return null;
    }
    out[size] = url;
  }
  return out;
}

export function parseMarketplaceImages(value: unknown): MarketplaceImages {
  const obj = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const images: MarketplaceImages = {};
  const icon = sizeUrls(obj.icon, ["sm", "md", "lg"] as const);
  if (icon) {
    images.icon = icon;
  }
  const banner = sizeUrls(obj.banner, ["card", "hero"] as const);
  if (banner) {
    images.banner = banner;
  }
  return images;
}

/** A non-negative integer rank, or undefined when the module is not featured. */
export function parseFeaturedRank(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** The featured modules in display order: by rank, then by name for equal ranks. */
export function featuredInOrder<T extends { name: string; featuredRank?: number }>(modules: readonly T[]): T[] {
  return modules
    .filter((m) => m.featuredRank !== undefined)
    .sort((a, b) => (a.featuredRank ?? 0) - (b.featuredRank ?? 0) || a.name.localeCompare(b.name));
}
