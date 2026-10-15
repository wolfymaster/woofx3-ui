import { api } from "@convex/_generated/api";
import type { CatalogListingDetail } from "@convex/lib/marketplaceCatalog";
import { isBundleListing, isModuleListing } from "@convex/lib/marketplaceCatalog";
import type { ModuleDetailResult } from "@convex/moduleDetail";
import { useAction, useQuery } from "convex/react";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Loader2, Package, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { CreditsCard } from "@/components/marketplace/credits-card";
import { EmoteGrid } from "@/components/marketplace/emote-grid";
import { ListingArt } from "@/components/marketplace/listing-art";
import { ListingInstallButton } from "@/components/marketplace/listing-install-button";
import { PreviewButton } from "@/components/marketplace/listing-preview";
import { ModuleIconImage } from "@/components/modules/module-image";
import { ApproveModulePermissionsDialog } from "@/components/modules/module-permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstance } from "@/hooks/use-instance";
import { useMarketplaceEntitlements, useMarketplaceListing } from "@/hooks/use-marketplace";
import { useModuleInstall } from "@/hooks/use-module-install";
import { listingInstallState } from "@/lib/listing-install-state";
import { formatPrice, listingTypeColor, listingTypeIcon, listingTypeMeta } from "@/lib/listing-type";
import { MARKETPLACE_PATH, marketplaceAuthorPath, marketplaceListingPath } from "@/lib/marketplace-route";

// One listing's page, for any of the five types.
//
// The page is one shape with type-specific sections, rather than a page per
// type: a streamer comparing an emote pack with an overlay should not have to
// learn two layouts, and price, credits, previews and the install button mean
// the same thing for all of them.

export default function MarketplaceListing() {
  const { instance } = useInstance();
  const [, navigate] = useLocation();
  const params = useParams<{ listingId: string }>();
  const listingId = params.listingId ?? null;
  const searchString = useSearch();

  const { listing, notFound, loading, error, refetch } = useMarketplaceListing(instance?._id ?? null, listingId);
  const entitlements = useMarketplaceEntitlements(instance?._id ?? null);

  // Stripe sends the buyer back here. The webhook that grants the entitlement
  // is a separate round trip from Stripe to the marketplace, so it may not
  // have landed when this page loads -- hence the re-read and the message,
  // rather than assuming the button has already flipped.
  const purchaseOutcome = useMemo(() => new URLSearchParams(searchString).get("purchase"), [searchString]);
  useEffect(() => {
    if (purchaseOutcome === "success") {
      void entitlements.refetch();
    }
  }, [purchaseOutcome, entitlements.refetch]);

  if (!listingId) {
    return null;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-6 lg:p-8">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={() => navigate(MARKETPLACE_PATH)}>
          <ArrowLeft className="h-4 w-4" />
          Marketplace
        </Button>

        {purchaseOutcome === "success" && (
          <Banner tone="success">
            Thanks — your purchase is being confirmed. The install button appears as soon as Stripe tells us it went
            through; reload if it takes more than a moment.
          </Banner>
        )}
        {purchaseOutcome === "cancelled" && <Banner tone="muted">Checkout cancelled. Nothing was charged.</Banner>}

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Failed to load this listing</span>
              </div>
              <p className="break-words text-sm text-muted-foreground">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {notFound && !error && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="font-medium">We couldn't find that listing.</p>
              <p className="text-sm text-muted-foreground">
                It may have been retired, or it may not be published to your instance.
              </p>
              <Button size="sm" variant="outline" onClick={() => navigate(MARKETPLACE_PATH)}>
                Back to the marketplace
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && !listing && <ListingSkeleton />}

        {listing && (
          <ListingBody
            listing={listing}
            owned={entitlements.owned.has(listing.id)}
            entitlementsLoading={entitlements.loading}
            entitlementsError={entitlements.error}
            onRefetch={() => {
              void refetch();
              void entitlements.refetch();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ListingBody({
  listing,
  owned,
  entitlementsLoading,
  entitlementsError,
  onRefetch,
}: {
  listing: CatalogListingDetail;
  owned: boolean;
  entitlementsLoading: boolean;
  entitlementsError: string | null;
  onRefetch: () => void;
}) {
  const { instance } = useInstance();
  const [, navigate] = useLocation();
  const meta = listingTypeMeta(listing.type);

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");
  const installedVersion = useMemo(() => {
    for (const module of repoModules ?? []) {
      const parts = module.moduleKey?.split(":");
      if (parts && parts[0] === listing.id) {
        return parts[1];
      }
    }
    return undefined;
  }, [repoModules, listing.id]);

  const baseModuleInstalled = useMemo(() => {
    if (!listing.baseModuleId) {
      return true;
    }
    return (repoModules ?? []).some((module) => module.moduleKey?.split(":")[0] === listing.baseModuleId);
  }, [repoModules, listing.baseModuleId]);

  // A module or theme install needs the permissions its archive declares,
  // which the catalog does not carry — this is the same action the module
  // page uses, so the two surfaces ask the streamer the same question.
  const getModuleDetail = useAction(api.moduleDetail.getModuleDetail);
  const [moduleDetail, setModuleDetail] = useState<ModuleDetailResult | null>(null);
  useEffect(() => {
    if (!instance || !isModuleListing(listing.type)) {
      setModuleDetail(null);
      return;
    }
    let cancelled = false;
    void getModuleDetail({ instanceId: instance._id, moduleId: listing.id })
      .then((detail) => {
        if (!cancelled) {
          setModuleDetail(detail);
        }
      })
      .catch(() => {
        // The install path refuses anything declaring an unapproved
        // permission anyway, so a failed read costs the approval preview,
        // not safety. The button stays usable.
        if (!cancelled) {
          setModuleDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [getModuleDetail, instance, listing.id, listing.type]);

  const install = useModuleInstall(instance?._id, onRefetch);
  const [bundleInstalled, setBundleInstalled] = useState<{ kind: "scene" | "alert" } | null>(null);

  const state = listingInstallState({
    listing,
    owned,
    entitlementsLoading,
    entitlementsError,
    installedVersion,
    baseModuleInstalled,
    bundleInstalled: bundleInstalled !== null,
  });

  const requestModuleInstall = useCallback(() => {
    install.request({
      marketplaceId: listing.id,
      mode: state.kind === "updatable" ? "update" : "install",
      moduleName: listing.name,
      permissionSets: {
        permissions: moduleDetail?.permissions,
        latestPermissions: moduleDetail?.latestPermissions,
        localEndpoints: moduleDetail?.localEndpoints,
        latestLocalEndpoints: moduleDetail?.latestLocalEndpoints,
      },
    });
  }, [install, listing.id, listing.name, moduleDetail, state.kind]);

  return (
    <>
      <div className="relative h-40 overflow-hidden rounded-2xl border bg-neutral-950">
        <ListingArt listing={listing} sizes="(min-width: 1024px) 1024px, 100vw" scale={1.3} />
        <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-background/20" />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="-mt-12 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card text-primary shadow-sm">
          {listing.images.icon ? (
            <ModuleIconImage icon={listing.images.icon} displaySize={80} />
          ) : (
            listingTypeIcon(listing.type, "h-8 w-8")
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                style={{ backgroundColor: listingTypeColor(listing.type) }}
              >
                {listingTypeIcon(listing.type, "h-3 w-3")}
                {meta.label}
              </span>
              {listing.tier === "dev" && (
                <Badge variant="outline" className="border-amber-500/60 text-amber-600 dark:text-amber-400">
                  Dev
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">v{listing.version}</span>
            </div>
            <h1 className="text-2xl font-bold leading-tight">{listing.name}</h1>
            <p className="text-sm text-muted-foreground">
              {listing.authorSlug ? (
                <button
                  type="button"
                  className="hover:text-foreground hover:underline"
                  onClick={() => navigate(marketplaceAuthorPath(listing.authorSlug as string))}
                >
                  by {listing.author}
                </button>
              ) : (
                <>by {listing.author || "Unknown"}</>
              )}
            </p>
          </div>

          <p className="text-sm">{listing.description}</p>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-[11px] font-normal">
                  <Tag className="h-2.5 w-2.5" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-56">
          <p className="text-right text-lg font-semibold">{formatPrice(listing.price)}</p>
          <ListingInstallButton
            instanceId={instance?._id}
            listing={listing}
            state={state}
            isInstalling={install.isInstalling}
            onInstallModule={requestModuleInstall}
            onBundleInstalled={(result) => {
              setBundleInstalled({ kind: result.kind });
              onRefetch();
            }}
            onOpenBaseModule={(moduleId) => navigate(marketplaceListingPath(moduleId))}
          />
          <PreviewButton listing={listing} className="w-full" />
          {install.isInstalling && install.progressMessage && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
              {install.progressMessage}
            </p>
          )}
          {install.error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {install.error}
            </p>
          )}
          {bundleInstalled && (
            <p className="flex items-start gap-1.5 text-xs text-emerald-600">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {bundleInstalled.kind === "scene"
                ? "Added to your scenes."
                : "Added to your alert library — start an alert from it."}
            </p>
          )}
        </div>
      </div>

      <CreditsCard credits={listing.credits} listingName={listing.name} />

      {listing.type === "emote" && (
        <Section title="What's in the pack">
          <EmoteGrid emotes={listing.emotes ?? []} license={listing.license} />
        </Section>
      )}

      {isBundleListing(listing.type) && (
        <Section title={listing.type === "overlay" ? "What this overlay installs" : "What this alert installs"}>
          <p className="text-sm text-muted-foreground">
            {listing.type === "overlay"
              ? "A ready-made scene. Installing adds it to your scene list, where you can edit it like any other."
              : "A ready-made alert. Installing adds it to your alert library to start new alerts from."}
          </p>
          {(listing.requires ?? []).length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Uses widgets from: {(listing.requires ?? []).join(", ")}
            </p>
          )}
        </Section>
      )}

      {listing.type === "theme" && listing.module && (
        <Section title="What this theme reskins">
          {listing.baseModuleId && (
            <p className="text-sm">
              Themes{" "}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => navigate(marketplaceListingPath(listing.baseModuleId as string))}
              >
                {listing.baseModuleId}
              </button>
              , which has to be installed first.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {listing.module.themes.map((theme) => (
              <li key={theme.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{theme.name}</p>
                {theme.description && <p className="text-xs text-muted-foreground">{theme.description}</p>}
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{theme.target}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {listing.type === "module" && listing.module && <ModuleSections module={listing.module} />}

      <ApproveModulePermissionsDialog {...install.approvalDialogProps} />
    </>
  );
}

function ModuleSections({ module }: { module: NonNullable<CatalogListingDetail["module"]> }) {
  const groups: { title: string; items: { id: string; name: string; description?: string }[] }[] = [
    { title: "Triggers", items: module.triggers },
    { title: "Actions", items: module.actions },
    { title: "Widgets", items: module.widgets },
    { title: "Functions", items: module.functions },
  ];

  return (
    <>
      {module.themeable.length > 0 && (
        <Section title="Accepts themes">
          <p className="text-sm text-muted-foreground">
            {module.themeable.length === 1
              ? "One of this module's widgets can be reskinned by a theme from the marketplace."
              : `${module.themeable.length} of this module's widgets can be reskinned by themes from the marketplace.`}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {module.themeable.map((contract) => (
              <Badge key={contract.widgetId} variant="secondary" className="font-mono text-[11px]">
                {contract.widgetId}
              </Badge>
            ))}
          </ul>
        </Section>
      )}

      {Object.keys(module.requires).length > 0 && (
        <Section title="Needs installed first">
          <ul className="space-y-1 text-sm">
            {Object.entries(module.requires).map(([moduleId, range]) => (
              <li key={moduleId} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{moduleId}</span>
                <span className="font-mono text-xs text-muted-foreground">{range}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <Section key={group.title} title={group.title}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                </li>
              ))}
            </ul>
          </Section>
        ))}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: "success" | "muted"; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "success"
          ? "rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400"
          : "rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
      }
    >
      {children}
    </div>
  );
}

function ListingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="flex gap-6">
        <Skeleton className="h-20 w-20 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}
