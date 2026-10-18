import type { CatalogListingDetail, ListingPreview } from "@convex/lib/marketplaceCatalog";

/**
 * What a listing can honestly show before it is installed.
 *
 * Every listing type gets a preview affordance, but "preview" means something
 * different for each, and pretending otherwise would put a dead button on half
 * the catalog:
 *
 * - An **emote pack** previews as itself: the rendered emotes *are* the
 *   product, so the grid already on the page is the preview and there is
 *   nothing for a dialog to add.
 * - Any listing with `previews[]` shows that gallery — the screenshots and
 *   video its author supplied.
 * - A **module with placeable widgets** has a live preview: a widget is
 *   exactly the thing a streamer wants to see before installing.
 * - A **theme** has no widgets of its own, so its live preview is the widget it
 *   reskins, which is the truthful answer to "what will this look like".
 * - Anything else has nothing to show, so there is no button at all.
 */

/**
 * The live preview a listing supports, or null.
 *
 * An author-declared `live` entry wins: they know their module better than a
 * derivation does. Otherwise it is synthesised from what the listing declares.
 */
export function livePreviewTarget(listing: CatalogListingDetail): ListingPreview | null {
  const declared = listing.previews.find((preview) => preview.kind === "live");
  if (declared) {
    return declared;
  }

  if (listing.type === "theme") {
    // A theme's `target` is `{moduleId}:widget:{widgetId}` — the widget it
    // restyles. Pointing the preview at that is why a theme is never the one
    // type with nothing to show.
    const target = listing.module?.themes.find((theme) => theme.target !== "")?.target;
    if (!target) {
      return null;
    }
    const widgetName = target.split(":").pop() ?? target;
    return {
      kind: "live",
      url: target,
      caption: listing.baseModuleId
        ? `Restyles the ${widgetName} widget from ${listing.baseModuleId}. Place it in a scene to see this theme applied.`
        : `Restyles the ${widgetName} widget. Place it in a scene to see this theme applied.`,
    };
  }

  const widgets = listing.module?.widgets ?? [];
  if (widgets.length === 0) {
    return null;
  }
  return {
    kind: "live",
    url: `${listing.id}:widget:${widgets[0].id}`,
    caption: `Place ${widgets[0].name} in a scene to see it live.`,
  };
}

/** The gallery entries: everything that is a file, in order. */
export function galleryPreviews(listing: CatalogListingDetail): ListingPreview[] {
  return listing.previews.filter((preview) => preview.kind !== "live");
}

/** Whether there is anything to open a preview dialog for. */
export function previewAvailable(listing: CatalogListingDetail): boolean {
  return galleryPreviews(listing).length > 0 || livePreviewTarget(listing) !== null;
}
