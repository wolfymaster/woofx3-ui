/**
 * Telling the marketplace that an install finished.
 *
 * Install counts are the storefront's strongest trust signal, and only this
 * side knows when an install actually completed: the marketplace hands out a
 * download URL or a bundle and never hears what became of it. So the count is
 * a ping from here, sent once per completed install of any listing type --
 * free listings included, since they are most of the catalog and counting only
 * purchases would show them as nobody's choice.
 */

import { marketplaceAuthed } from "./marketplaceApi";

/**
 * Records one completed install. Never throws: a streamer whose module is
 * installed and running must not see a failure because a counter did not
 * increment, and the count is a popularity signal, not an entitlement.
 */
export async function recordListingInstall(listingId: string): Promise<void> {
  if (listingId === "") {
    return;
  }
  try {
    await marketplaceAuthed(`/catalog/${encodeURIComponent(listingId)}/installs`, "POST");
  } catch (err) {
    console.warn(`Marketplace install count for ${listingId} was not recorded:`, err);
  }
}
