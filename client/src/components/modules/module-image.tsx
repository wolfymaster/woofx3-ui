import type { MarketplaceBannerUrls, MarketplaceIconUrls } from "@shared/marketplace-images";
import type { BannerRendition } from "@/lib/marketplace-banner";
import { cn } from "@/lib/utils";

// Width descriptors are the renditions' pixel widths, documented on the types
// in shared/marketplace-images.ts. They let the browser pick the smallest
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
  /**
   * The one rendition to show. Card and hero have different proportions, so the parent is
   * sized for one of them (`BANNER_ASPECT`) and the image never swaps to the other.
   */
  rendition: BannerRendition;
  className?: string;
}

/** Fills its positioned parent, cropping to cover it. */
export function ModuleBannerImage({ banner, rendition, className }: ModuleBannerImageProps) {
  return (
    <img
      src={banner[rendition]}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}
