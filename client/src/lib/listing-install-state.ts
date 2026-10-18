import type { CatalogListingDetail, ListingQuote } from "@convex/lib/marketplaceCatalog";
import type { ListingInstallState } from "@/components/marketplace/listing-install-button";
import { isNewerVersion } from "@/lib/utils";

export interface InstallStateInput {
  listing: CatalogListingDetail;
  /** What the marketplace says this account must do to hold the listing. */
  quote: ListingQuote | null;
  /** The quote has not come back yet. */
  quoteLoading: boolean;
  /** The quote could not be read at all. */
  quoteError: string | null;
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
 *    refuses it — so that outranks everything about buying it.
 * 3. Already installed outranks the quote: an installed listing should not
 *    offer to sell itself again.
 * 4. A free, current listing installs without waiting for a quote; the
 *    install claims it.
 * 5. Everything else is the marketplace's quote, which alone knows what this
 *    account holds — an earlier edition that earns an upgrade, say. Until it
 *    arrives the button waits, and a quote that cannot be read is "unknown"
 *    rather than a guess: the server refuses an install it cannot verify.
 */
export function listingInstallState({
  listing,
  quote,
  quoteLoading,
  quoteError,
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
  if (listing.pricing?.mode === "free" && listing.supersededBy === undefined) {
    return { kind: "installable" };
  }
  if (quoteError !== null) {
    return { kind: "unknown" };
  }
  if (quoteLoading || quote === null) {
    return { kind: "checking" };
  }
  switch (quote.kind) {
    case "owned":
      return { kind: "installable", owned: listing.pricing?.mode === "paid" };
    case "free":
      return { kind: "installable" };
    case "upgrade_free":
      return { kind: "installable", upgradeFrom: quote.upgradeFrom };
    case "upgrade":
      return {
        kind: "purchasable",
        amountCents: quote.amountCents,
        currency: quote.currency,
        upgradeFrom: quote.upgradeFrom,
      };
    case "full":
      return { kind: "purchasable", amountCents: quote.amountCents, currency: quote.currency };
    case "unavailable":
      return { kind: "unavailable", reason: quote.reason, supersededBy: listing.supersededBy };
  }
}
