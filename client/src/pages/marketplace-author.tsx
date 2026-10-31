import type { CatalogListing, ListingType } from "@shared/marketplace-catalog";
import { LISTING_TYPES } from "@shared/marketplace-catalog";
import { AlertCircle, ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { ListingCard } from "@/components/marketplace/listing-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEngineScope } from "@/engine/context";
import { useMarketplaceAuthor, useMarketplaceEntitlements } from "@/hooks/use-marketplace";
import { listingTypeMeta } from "@/lib/listing-type";
import { MARKETPLACE_PATH, marketplaceAuthorPath, marketplaceListingPath } from "@/lib/marketplace-route";

// An author's page: everything they have published, across every listing type.
//
// Grouped by type rather than shown as one grid, because "what does this
// person make" is the question the page answers -- someone who ships three
// emote packs and one module reads very differently from the reverse.

export default function MarketplaceAuthor() {
  const { instanceId } = useEngineScope();
  const [, navigate] = useLocation();
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? null;

  const { page, notFound, loading, error, hasMore, loadingMore, loadMoreError, loadMore } = useMarketplaceAuthor(
    instanceId,
    slug
  );
  const entitlements = useMarketplaceEntitlements(instanceId);

  const grouped = useMemo(() => {
    const byType = new Map<ListingType, CatalogListing[]>();
    for (const listing of page?.listings ?? []) {
      const existing = byType.get(listing.type);
      if (existing) {
        existing.push(listing);
      } else {
        byType.set(listing.type, [listing]);
      }
    }
    // Fixed type order, so the sections do not reshuffle between authors.
    return LISTING_TYPES.map((type) => ({ type, listings: byType.get(type) ?? [] })).filter(
      (group) => group.listings.length > 0
    );
  }, [page]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full space-y-8 p-6 lg:p-8">
        <Button variant="ghost" size="sm" className="-ml-2 gap-2" onClick={() => navigate(MARKETPLACE_PATH)}>
          <ArrowLeft className="h-4 w-4" />
          Marketplace
        </Button>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="space-y-2 pt-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Failed to load this author</span>
              </div>
              <p className="break-words text-sm text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        )}

        {notFound && !error && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <p className="font-medium">No author here.</p>
              <p className="text-sm text-muted-foreground">Nobody by that name has published to the marketplace.</p>
              <Button size="sm" variant="outline" onClick={() => navigate(MARKETPLACE_PATH)}>
                Back to the marketplace
              </Button>
            </CardContent>
          </Card>
        )}

        {loading && !page && (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        )}

        {page && (
          <>
            <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Avatar className="h-16 w-16 shrink-0 border">
                {page.author.avatarUrl && <AvatarImage src={page.author.avatarUrl} alt="" />}
                <AvatarFallback className="text-lg font-semibold">
                  {page.author.displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 space-y-2">
                <h1 className="text-2xl font-bold leading-tight">{page.author.displayName}</h1>
                <p className="text-sm text-muted-foreground">
                  {page.total} {page.total === 1 ? "listing" : "listings"} in the marketplace
                </p>
                {page.author.bio && <p className="text-sm">{page.author.bio}</p>}
                {page.author.links.length > 0 && (
                  <ul className="flex flex-wrap gap-3">
                    {page.author.links.map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          {link.label}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {!page.author.claimed && (
                  <p className="text-xs text-muted-foreground">{page.author.displayName} hasn't added a profile yet.</p>
                )}
              </div>
            </header>

            {grouped.map((group) => (
              <section key={group.type} className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {listingTypeMeta(group.type).plural}
                  <span className="ml-2 font-normal normal-case tracking-normal">{group.listings.length}</span>
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
                  {group.listings.map((listing) => (
                    <ListingCard
                      key={listing.id}
                      listing={listing}
                      state={{ isOwned: entitlements.owned.has(listing.id) }}
                      onClick={() => navigate(marketplaceListingPath(listing.id))}
                      onAuthorClick={(authorSlug) => navigate(marketplaceAuthorPath(authorSlug))}
                    />
                  ))}
                </div>
              </section>
            ))}

            {hasMore && (
              <div className="flex flex-col items-center gap-2">
                <Button variant="outline" className="gap-2" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  Show more ({page.total - page.listings.length} more)
                </Button>
                {loadMoreError && <p className="text-xs text-destructive">{loadMoreError}</p>}
              </div>
            )}

            {grouped.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing published yet — or nothing visible to this instance.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
