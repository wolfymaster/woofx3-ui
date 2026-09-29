import type { MarketplaceBannerUrls, MarketplaceIconUrls } from "@convex/lib/marketplaceImages";
import { cn } from "@/lib/utils";

// Width descriptors are the renditions' pixel widths, documented on the types
// in convex/lib/marketplaceImages.ts. They let the browser pick the smallest
// rendition that is sharp at the displayed size and pixel density.

interface ModuleIconImageProps {
  icon: MarketplaceIconUrls;
  /** Rendered width and height in CSS pixels. */
  displaySize: number;
  className?: string;
}

export function ModuleIconImage({ icon, displaySize, className }: ModuleIconImageProps) {
  return (
    <img
      src={icon.md}
      srcSet={`${icon.sm} 64w, ${icon.md} 128w, ${icon.lg} 256w`}
      sizes={`${displaySize}px`}
      width={displaySize}
      height={displaySize}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

interface ModuleBannerImageProps {
  banner: MarketplaceBannerUrls;
  /** The `sizes` attribute: how wide the banner renders at each breakpoint. */
  sizes: string;
  className?: string;
}

/** Fills its positioned parent, cropping to cover it. */
export function ModuleBannerImage({ banner, sizes, className }: ModuleBannerImageProps) {
  return (
    <img
      src={banner.card}
      srcSet={`${banner.card} 512w, ${banner.hero} 1600w`}
      sizes={sizes}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
