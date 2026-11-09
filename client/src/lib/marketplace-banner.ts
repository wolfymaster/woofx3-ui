import type { MarketplaceBannerUrls } from "@shared/marketplace-images";

/** Which banner rendition a surface shows. */
export type BannerRendition = keyof MarketplaceBannerUrls;

/**
 * The art area for each rendition, at the rendition's own proportions so a banner shows
 * whole: authors design banners with their title near the edges, and cropping cuts it off.
 * Must match the rendition sizes in shared/marketplace-images.ts (card 512×224, hero 1600×512).
 */
export const BANNER_ASPECT: Record<BannerRendition, string> = {
  card: "aspect-[16/7]",
  hero: "aspect-[25/8]",
};
