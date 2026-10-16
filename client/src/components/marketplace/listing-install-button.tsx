import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CatalogListingDetail } from "@convex/lib/marketplaceCatalog";
import { isBundleListing } from "@convex/lib/marketplaceCatalog";
import { useAction } from "convex/react";
import { AlertCircle, Check, CreditCard, Download, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/listing-type";
import { cn } from "@/lib/utils";

/**
 * The one button that moves a listing forward, in whichever of its states it
 * is in: Buy, then Install, then Installed.
 *
 * A paid listing shows Buy until the account owns it. Buying is a redirect to
 * Stripe and a return to this page, so "owned" is not something this component
 * can decide — it is told, by the entitlements the page fetched. The install is
 * refused server-side for anything unpaid regardless, so a wrong answer here
 * costs a confusing button rather than a free module.
 */

export type ListingInstallState =
  /** Free, or paid and owned. */
  | { kind: "installable" }
  /** Paid and not owned. */
  | { kind: "purchasable" }
  /** Already on this instance. */
  | { kind: "installed" }
  /** A newer version of an installed module is available. */
  | { kind: "updatable" }
  /** A theme whose base module is missing. */
  | { kind: "needs_base_module"; baseModuleId: string }
  /** Entitlements could not be read, so ownership is unknown. */
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
  isInstalling,
  className,
}: ListingInstallButtonProps) {
  const createCheckout = useAction(api.marketplaceCatalog.createCheckout);
  const installBundle = useAction(api.marketplaceCatalog.installBundle);
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
      }
      // "already_entitled" needs no message: the page re-reads entitlements
      // when it regains focus and the button becomes Install on its own.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setBusy(false);
    }
  }, [createCheckout, instanceId, listing.id]);

  const runBundleInstall = useCallback(async () => {
    if (!instanceId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await installBundle({ instanceId, listingId: listing.id });
      onBundleInstalled?.({ kind: result.kind, engineId: result.engineId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Install failed.");
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
          listing={listing}
          working={working}
          disabled={!instanceId}
          onPurchase={() => void startCheckout()}
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
  listing,
  working,
  disabled,
  onPurchase,
  onInstall,
}: {
  state: ListingInstallState;
  listing: CatalogListingDetail;
  working: boolean;
  disabled: boolean;
  onPurchase: () => void;
  onInstall: () => void;
}) {
  if (state.kind === "installed") {
    return (
      <Button disabled className="gap-2">
        <Check className="h-4 w-4" />
        Installed
      </Button>
    );
  }

  if (state.kind === "purchasable" || state.kind === "unknown") {
    return (
      <>
        <Button className="gap-2" disabled={disabled || working} onClick={onPurchase}>
          {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          Buy for {formatPrice(listing.price)}
        </Button>
        {state.kind === "unknown" && (
          // Ownership could not be read. Buy is the safe button: the server
          // refuses an install it cannot verify, so offering Install here
          // would produce a failure the streamer cannot act on.
          <p className="text-xs text-muted-foreground">
            We couldn't check your purchases just now. If you already own this, reload the page.
          </p>
        )}
      </>
    );
  }

  const label = state.kind === "updatable" ? "Update" : "Install";
  return (
    <Button className="gap-2" disabled={disabled || working} onClick={onInstall}>
      {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
      {listing.price && <span className="text-xs opacity-80">· owned</span>}
    </Button>
  );
}
