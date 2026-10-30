import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CatalogListingDetail } from "@shared/marketplace-catalog";
import { isBundleListing } from "@shared/marketplace-catalog";
import { useAction } from "convex/react";
import { AlertCircle, Check, CreditCard, Download, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMarketplaceBundleInstallRequest } from "@/engine/hooks/use-modules";
import { actionErrorMessage } from "@/lib/action-error";
import { formatAmount } from "@/lib/listing-type";
import { cn } from "@/lib/utils";

/**
 * The one button that moves a listing forward, in whichever of its states it
 * is in: Buy, then Install, then Installed.
 *
 * What the account must pay is the marketplace's quote, which the page
 * fetched: this component never works out a price. The install is refused
 * server-side for anything the account does not hold regardless, so a wrong
 * answer here costs a confusing button rather than a free module.
 */

export type ListingInstallState =
  /**
   * The account may install it: free, owned (`owned` on a paid listing), or a
   * free upgrade from the earlier edition `upgradeFrom`.
   */
  | { kind: "installable"; owned?: boolean; upgradeFrom?: string }
  /** Costs this account the quoted amount; `upgradeFrom` when it is an upgrade price. */
  | { kind: "purchasable"; amountCents: number; currency: string; upgradeFrom?: string }
  /** Nobody can acquire it now; `reason` is the marketplace's. */
  | { kind: "unavailable"; reason: string; supersededBy?: string }
  /** The quote has not come back yet. */
  | { kind: "checking" }
  /** Already on this instance. */
  | { kind: "installed" }
  /** A newer version of an installed module is available. */
  | { kind: "updatable" }
  /** A theme whose base module is missing. */
  | { kind: "needs_base_module"; baseModuleId: string }
  /** The quote could not be read, so what the account holds is unknown. */
  | { kind: "unknown" }
  /** An emote pack: nothing installs, and the images on the page are the product. */
  | { kind: "not_installable" };

interface ListingInstallButtonProps {
  instanceId: Id<"instances"> | undefined;
  listing: CatalogListingDetail;
  state: ListingInstallState;
  /** Installs a module or theme. Bundles install through this component. */
  onInstallModule?: () => void;
  /** Called after a bundle install writes its scene or composition. */
  onBundleInstalled?: (result: { kind: "scene" | "alert"; engineId: string }) => void;
  /** Opens the base module a theme needs. */
  onOpenBaseModule?: (moduleId: string) => void;
  /** Opens another listing: the newer edition that replaced this one. */
  onOpenListing?: (listingId: string) => void;
  /** Checkout found nothing to pay, or that the account already holds it: read the quote again. */
  onQuoteStale?: () => void;
  isInstalling?: boolean;
  className?: string;
}

export function ListingInstallButton({
  instanceId,
  listing,
  state,
  onInstallModule,
  onBundleInstalled,
  onOpenBaseModule,
  onOpenListing,
  onQuoteStale,
  isInstalling,
  className,
}: ListingInstallButtonProps) {
  const createCheckout = useAction(api.marketplaceCatalog.createCheckout);
  const installBundle = useMarketplaceBundleInstallRequest();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await createCheckout({
        instanceId,
        listingId: listing.id,
        // A path, not a URL. The server joins it onto the configured app
        // origin, so a checkout can only ever return the buyer to woofx3.
        returnPath: `/marketplace/listing/${encodeURIComponent(listing.id)}`,
      });
      if (result.status === "redirect") {
        window.location.assign(result.url);
        return;
      }
      if (result.status === "unavailable") {
        setError(result.message);
        return;
      }
      // Already held, or nothing to pay: the quote is out of date, and the
      // fresh one turns the button into Install.
      onQuoteStale?.();
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [createCheckout, instanceId, listing.id, onQuoteStale]);

  const runBundleInstall = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onBundleInstalled?.(await installBundle(listing.id));
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [installBundle, instanceId, listing.id, onBundleInstalled]);

  const working = busy || isInstalling === true;

  if (state.kind === "not_installable") {
    return null;
  }

  return (
    <div className={cn("flex flex-col items-stretch gap-2", className)}>
      {state.kind === "needs_base_module" ? (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">Needs {state.baseModuleId} first</p>
          <p className="text-xs text-muted-foreground">
            A theme reskins a module you already have. Install {state.baseModuleId}, then come back for this.
          </p>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => onOpenBaseModule?.(state.baseModuleId)}>
            <ExternalLink className="h-3.5 w-3.5" />
            Open {state.baseModuleId}
          </Button>
        </div>
      ) : (
        <PrimaryAction
          state={state}
          working={working}
          disabled={!instanceId}
          onPurchase={() => void startCheckout()}
          onOpenListing={onOpenListing}
          onInstall={() => {
            if (isBundleListing(listing.type)) {
              void runBundleInstall();
              return;
            }
            onInstallModule?.();
          }}
        />
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function PrimaryAction({
  state,
  working,
  disabled,
  onPurchase,
  onInstall,
  onOpenListing,
}: {
  state: ListingInstallState;
  working: boolean;
  disabled: boolean;
  onPurchase: () => void;
  onInstall: () => void;
  onOpenListing?: (listingId: string) => void;
}) {
  if (state.kind === "installed") {
    return (
      <Button disabled className="gap-2">
        <Check className="h-4 w-4" />
        Installed
      </Button>
    );
  }

  if (state.kind === "checking") {
    return (
      <Button disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking…
      </Button>
    );
  }

  if (state.kind === "unknown") {
    return (
      <>
        <Button disabled className="gap-2">
          <AlertCircle className="h-4 w-4" />
          Unavailable right now
        </Button>
        <p className="text-xs text-muted-foreground">
          We couldn't check what this costs you just now. Reload the page to try again.
        </p>
      </>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <>
        <Button disabled className="gap-2">
          Not available
        </Button>
        <p className="text-xs text-muted-foreground">{unavailableReason(state.reason)}</p>
        {state.reason === "superseded" && state.supersededBy && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => onOpenListing?.(state.supersededBy as string)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            See the new edition
          </Button>
        )}
      </>
    );
  }

  if (state.kind === "purchasable") {
    const amount = formatAmount(state.amountCents, state.currency);
    return (
      <>
        <Button className="gap-2" disabled={disabled || working} onClick={onPurchase}>
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {state.upgradeFrom ? `Upgrade for ${amount}` : `Buy for ${amount}`}
        </Button>
        {state.upgradeFrom && (
          <p className="text-xs text-muted-foreground">Upgrade price, because you own an earlier edition.</p>
        )}
      </>
    );
  }

  if (state.kind === "needs_base_module" || state.kind === "not_installable") {
    return null;
  }

  const label = state.kind === "updatable" ? "Update" : state.upgradeFrom ? "Upgrade — free" : "Install";
  return (
    <Button className="gap-2" disabled={disabled || working} onClick={onInstall}>
      {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
      {state.kind === "installable" && state.owned && <span className="text-xs opacity-80">· owned</span>}
    </Button>
  );
}

/** Why a listing cannot be acquired, from the marketplace's reason code. */
function unavailableReason(reason: string): string {
  switch (reason) {
    case "superseded":
      return "A newer edition has replaced this one.";
    case "unpriced":
      return "This listing isn't on sale yet.";
    case "not_ready":
      return "This listing isn't published yet.";
    case "commerce_unconfigured":
      return "Purchases aren't available on this deployment.";
    default:
      return "This listing can't be installed right now.";
  }
}
