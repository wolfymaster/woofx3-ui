import type { ListingType } from "@convex/lib/marketplaceCatalog";
import { Bell, Image, Layers, Palette, Puzzle } from "lucide-react";

/**
 * How each listing type presents itself.
 *
 * Types are a closed set, unlike module categories, which are free text from
 * manifests. So these get real icons and fixed hues rather than the hash-derived
 * colour `module-category.tsx` uses — a streamer looking for emotes should see
 * the same swatch every time, in the sidebar and on a card.
 */
interface ListingTypeMeta {
  /** Singular, for a badge on one listing. */
  label: string;
  /** Plural, for the category rail and section headings. */
  plural: string;
  icon: React.ComponentType<{ className?: string }>;
  /** OKLCH hue, used for the swatch and the placeholder banner. */
  hue: number;
  /** One line: what this kind of listing is. */
  blurb: string;
}

const META: Record<ListingType, ListingTypeMeta> = {
  module: {
    label: "Module",
    plural: "Modules",
    icon: Puzzle,
    hue: 264,
    blurb: "Installable behaviour: triggers, actions, widgets and workflows.",
  },
  theme: {
    label: "Theme",
    plural: "Themes",
    icon: Palette,
    hue: 318,
    blurb: "Reskins a widget of a module you already have. No new behaviour.",
  },
  emote: {
    label: "Emote pack",
    plural: "Emotes",
    icon: Image,
    hue: 28,
    blurb: "Static and animated emote sets, ready to upload to your channel.",
  },
  overlay: {
    label: "Overlay",
    plural: "Overlays",
    icon: Layers,
    hue: 196,
    blurb: "A prepackaged scene, dropped straight into your scene list.",
  },
  alert: {
    label: "Alert",
    plural: "Alerts",
    icon: Bell,
    hue: 142,
    blurb: "A prepackaged alert, added to your alert library to start from.",
  },
};

export function listingTypeMeta(type: ListingType): ListingTypeMeta {
  return META[type];
}

export function listingTypeIcon(type: ListingType, className = "h-3.5 w-3.5") {
  const Icon = META[type].icon;
  return <Icon className={className} />;
}

export function listingTypeColor(type: ListingType): string {
  return `oklch(0.6 0.17 ${META[type].hue})`;
}

/**
 * The type's hue on the HSL wheel, for art and glows.
 *
 * `listingTypeColor` is the same hue as a flat swatch; this is for the places
 * that mix their own colour from it -- a card's placeholder art derives a
 * gradient, a glow and a motif outline from one number, so a themed card is
 * recognisably a theme before its name is read.
 */
export function listingTypeHue(type: ListingType): number {
  return META[type].hue;
}

/** `$4.99`, or "Free" when there is no price. */
export function formatPrice(price: { amountCents: number; currency: string } | undefined): string {
  if (!price) {
    return "Free";
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency.toUpperCase(),
    }).format(price.amountCents / 100);
  } catch {
    // An unknown currency code would otherwise throw and blank the card.
    return `${(price.amountCents / 100).toFixed(2)} ${price.currency.toUpperCase()}`;
  }
}
