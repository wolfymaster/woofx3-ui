import type { CatalogListingDetail } from "@convex/lib/marketplaceCatalog";
import type { ListingInstallState } from "@/components/marketplace/listing-install-button";
import { isNewerVersion } from "@/lib/utils";

export interface InstallStateInput {
  listing: CatalogListingDetail;
  /** The account has bought this paid listing. */
  owned: boolean;
  /** Entitlements have not come back yet. */
  entitlementsLoading: boolean;
  /** Entitlements could not be read at all. */
  entitlementsError: string | null;
  /** The version installed on this instance, if any. */
  installedVersion: string | undefined;
  /** False only for a theme whose base module is missing. */
  baseModuleInstalled: boolean;
  /** A bundle install already succeeded in this session. */
  bundleInstalled: boolean;
}

/**
 * Which state a listing's one button is in.
 *
 * One function so the states stay mutually exclusive and the precedence is
 * visible in one place, because the ordering is the whole of the logic:
 *
 * 1. An emote pack installs nothing: there is no engine call for it, so
 *    offering Install would send its id down the module install path.
 * 2. A theme with no base module cannot be installed at all — the engine
 *    refuses it — so that outranks ownership.
 * 3. Already installed outranks ownership: a bought-and-installed listing
 *    should not offer to sell itself again.
 * 4. A free listing is installable, full stop. That is every listing that
 *    existed before commerce, and nothing about them changed.
 * 5. Ownership that could not be read falls back to Buy, not Install: the
 *    server refuses an install it cannot verify either, so Install would
 *    produce a failure the streamer cannot act on.
 */
export function listingInstallState({
  listing,
  owned,
  entitlementsLoading,
  entitlementsError,
  installedVersion,
  baseModuleInstalled,
  bundleInstalled,
}: InstallStateInput): ListingInstallState {
  if (listing.type === "emote") {
    return { kind: "not_installable" };
  }
  if (listing.type === "theme" && listing.baseModuleId && !baseModuleInstalled) {
    return { kind: "needs_base_module", baseModuleId: listing.baseModuleId };
  }
  if (bundleInstalled) {
    return { kind: "installed" };
  }
  if (installedVersion !== undefined) {
    return isNewerVersion(listing.version, installedVersion) ? { kind: "updatable" } : { kind: "installed" };
  }
  if (listing.price === undefined) {
    return { kind: "installable" };
  }
  if (entitlementsError !== null) {
    return { kind: "unknown" };
  }
  // Still loading: Buy is the honest placeholder. Showing Install and then
  // taking it away is worse than showing Buy and then enabling Install.
  if (entitlementsLoading) {
    return { kind: "purchasable" };
  }
  return owned ? { kind: "installable" } : { kind: "purchasable" };
}
