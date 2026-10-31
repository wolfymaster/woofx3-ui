import { installedVersionsByListing } from "@convex/lib/marketplaceInstallIdentity";
import type { CatalogListing, ListingType } from "@shared/marketplace-catalog";
import { featuredInOrder } from "@shared/marketplace-images";
import { Loader2, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { CategoryTiles } from "@/components/marketplace/category-tiles";
import { ListingCard, type ListingCardState } from "@/components/marketplace/listing-card";
import { StorefrontHero } from "@/components/marketplace/storefront-hero";
import { CardRail, SectionHead } from "@/components/marketplace/storefront-section";
import {
  StorefrontEmptyCatalog,
  StorefrontError,
  StorefrontNoResults,
} from "@/components/marketplace/storefront-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEngineScope } from "@/engine/context";
import { useInstalledModules } from "@/engine/hooks/use-modules";
import type { MarketplaceSort } from "@/engine/types";
import {
  type MarketplaceSearch,
  useDebounced,
  useMarketplaceEntitlements,
  useMarketplaceSearch,
} from "@/hooks/use-marketplace";
import { useTheme } from "@/hooks/use-theme";
import { bestsellerFloor, type ListingBadge, listingBadge } from "@/lib/listing-signals";
import { listingTypeMeta } from "@/lib/listing-type";
import {
  ALL_CATEGORIES,
  marketplaceAuthorPath,
  marketplaceFilterPath,
  marketplaceListingPath,
  parseMarketplaceFilter,
} from "@/lib/marketplace-route";
import { cn, isNewerVersion } from "@/lib/utils";

// The marketplace storefront.
//
// The page is a stack of sections and each section is one catalog query: the
// hero asks for curated listings, the trending rail asks for the most
// installed, the tiles ask for counts. Nothing on the page is hardcoded except
// the layout, so what the store sells is the marketplace's statement rather
// than this file's.
//
// Searching or filtering replaces all of it with one result grid. A streamer
// who has typed something is looking for that thing, not for the front window.
//
// Every section degrades on its own. The marketplace is a separate service
// with its own release cycle, so one that cannot sort by popularity simply has
// no trending rail, and one that counts no installs says nothing about
// installs -- rather than the page failing, or printing a zero that reads as
// "nobody wanted this".

/** Featured slots the hero can fill: one large, two small. */
const HERO_COUNT = 3;
const TRENDING_COUNT = 10;
const WHATS_NEW_COUNT = 12;
const PAGE_SIZE = 24;

export default function Marketplace({
  overview,
  typeCounts,
}: {
  /** The catalog's newest-first first page, read by the section around this page. */
  overview: MarketplaceSearch;
  typeCounts: Record<ListingType, number>;
}) {
  const { instanceId } = useEngineScope();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const {
    type: selectedType,
    category: selectedCategory,
    browseAll,
  } = useMemo(() => parseMarketplaceFilter(searchString), [searchString]);

  const [queryInput, setQueryInput] = useState("");
  const [sort, setSort] = useState<MarketplaceSort>("relevance");
  const [offset, setOffset] = useState(0);
  const query = useDebounced(queryInput).trim();

  // Changing what is being looked at starts the page over; staying on page 3
  // of a different result set shows an empty grid for no visible reason. Keyed
  // on the URL because the rail changes the filter from outside this page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchString re-triggers the reset, it is not a value read in the body
  useEffect(() => {
    setOffset(0);
  }, [searchString]);

  const isFiltering = query !== "" || selectedType !== null || selectedCategory !== ALL_CATEGORIES || browseAll;
  // The storefront's own sections are not fetched while a search is on screen.
  // Passing null holds what they already fetched rather than discarding it, so
  // clearing the search box puts the front window back without a round trip.
  const storefrontId = isFiltering ? null : instanceId;

  // Relevance with no query text is the marketplace's own storefront order,
  // which puts curation first -- so `featured=true` comes back in
  // `featuredRank` order without asking for a sort that would override it.
  const featured = useMarketplaceSearch(storefrontId, {
    query: "",
    types: [],
    featured: true,
    sort: "relevance",
    limit: HERO_COUNT + 2,
  });

  // "trending" is the last seven days, and the marketplace falls back to the
  // lifetime order for a week nobody installed anything in -- so one query
  // answers the rail whichever kind of week it is, and the heading below says
  // which one came back.
  const trending = useMarketplaceSearch(storefrontId, {
    query: "",
    types: [],
    sort: "trending",
    limit: TRENDING_COUNT,
  });

  const results = useMarketplaceSearch(isFiltering ? instanceId : null, {
    query,
    types: selectedType ? [selectedType] : [],
    category: selectedCategory === ALL_CATEGORIES ? undefined : selectedCategory,
    sort,
    limit: PAGE_SIZE,
    offset,
  });

  const entitlements = useMarketplaceEntitlements(instanceId);
  const installedModules = useInstalledModules();

  const installedVersions = useMemo(() => installedVersionsByListing(installedModules ?? []), [installedModules]);

  const stateFor = useCallback(
    (listing: CatalogListing) => {
      const installedVersion = installedVersions.get(listing.id);
      return {
        isInstalled: installedVersion !== undefined,
        updateAvailable: installedVersion ? isNewerVersion(listing.version, installedVersion) : false,
        isOwned: entitlements.owned.has(listing.id),
      };
    },
    [installedVersions, entitlements.owned]
  );

  const all = overview.page?.listings ?? [];

  // A badge is relative to the catalog, not to the section a card sits in: the
  // tenth most installed listing is not a bestseller because it leads the rail
  // it happens to be in. The overview is the widest view of the catalog the
  // page has, so the decile is measured there.
  const badgeContext = useMemo(
    () => ({
      bestsellerFloor: bestsellerFloor(all.length > 0 ? all : (trending.page?.listings ?? [])),
      now: Date.now(),
    }),
    [all, trending.page]
  );
  const badgeFor = useCallback((listing: CatalogListing) => listingBadge(listing, badgeContext), [badgeContext]);

  // Curation is the marketplace's. `featured=true` is a new parameter and an
  // older marketplace ignores unknown ones, so what comes back is filtered
  // again here -- an unfiltered page would otherwise put an uncurated listing
  // under a "Featured" kicker.
  const heroListings = useMemo(() => {
    const curated = featuredInOrder(featured.page?.listings ?? []);
    return (curated.length > 0 ? curated : featuredInOrder(all)).slice(0, HERO_COUNT);
  }, [featured.page, all]);

  // "Most installed" with nothing installed is not a ranking. A marketplace
  // that does not count installs yet gets no rail rather than a rail of
  // listings in an order it cannot justify -- and a quiet week gets the
  // lifetime chart under a heading that says so, rather than seven days of
  // nothing presented as what is hot.
  const trendingRail = useMemo(() => {
    const listings = trending.page?.listings ?? [];
    if (listings.some((listing) => listing.weeklyInstallCount > 0)) {
      return { listings, title: "Trending now", subtitle: "Most installed this week", sort: "trending" as const };
    }
    if (listings.some((listing) => listing.installCount > 0)) {
      return { listings, title: "Most installed", subtitle: "The catalog's favourites", sort: "popular" as const };
    }
    return { listings: [], title: "", subtitle: "", sort: "popular" as const };
  }, [trending.page]);

  const whatsNew = useMemo(() => all.slice(0, WHATS_NEW_COUNT), [all]);

  // Real art on a category tile beats generated art, so each tile borrows the
  // newest listing of its type that has a banner.
  const categorySample = useMemo(() => {
    const sample: Partial<Record<ListingType, CatalogListing>> = {};
    for (const listing of all) {
      const held = sample[listing.type];
      if (!held || (!held.images.banner && listing.images.banner)) {
        sample[listing.type] = listing;
      }
    }
    return sample;
  }, [all]);

  const openListing = useCallback((id: string) => navigate(marketplaceListingPath(id)), [navigate]);
  const openAuthor = useCallback((slug: string) => navigate(marketplaceAuthorPath(slug)), [navigate]);
  const clearFilters = useCallback(() => {
    setQueryInput("");
    navigate(marketplaceFilterPath({ type: null, category: ALL_CATEGORIES, browseAll: false }));
  }, [navigate]);

  /** What a section's "view all" does: open the whole catalog as a grid. */
  const browseEverything = useCallback(() => {
    setQueryInput("");
    navigate(marketplaceFilterPath({ type: null, category: ALL_CATEGORIES, browseAll: true }));
  }, [navigate]);

  const refreshAll = useCallback(() => {
    void overview.refetch();
    void entitlements.refetch();
    void featured.refetch();
    void trending.refetch();
    if (isFiltering) {
      void results.refetch();
    }
  }, [overview, entitlements, featured, trending, results, isFiltering]);

  const grid = results.page;
  const heading = query
    ? `Results for "${query}"`
    : selectedType
      ? listingTypeMeta(selectedType).plural
      : selectedCategory !== ALL_CATEGORIES
        ? selectedCategory
        : "Everything";

  // Only the reads the visible part of the page depends on can take it down.
  // A trending rail that 404s is a missing rail; an overview that fails is a
  // storefront with nothing in it.
  const fatalError = isFiltering ? (results.error ?? overview.error) : overview.error;
  const loadingFirstPage = overview.loading && overview.page === null;
  const catalogIsEmpty = !isFiltering && overview.page !== null && all.length === 0;

  return (
    <div className="flex-1 overflow-auto">
      <StorefrontTopBar
        query={queryInput}
        onQueryChange={(value) => {
          setQueryInput(value);
          setOffset(0);
        }}
        onRefresh={refreshAll}
        refreshing={overview.loading}
      />

      <div className="w-full space-y-12 p-6 lg:p-8">
        <PageIntro
          introId="modules"
          onTry={() => navigate(marketplaceFilterPath({ type: "emote", category: ALL_CATEGORIES, browseAll: false }))}
        />

        {fatalError && <StorefrontError message={fatalError} onRetry={refreshAll} />}

        {loadingFirstPage && (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {catalogIsEmpty && <StorefrontEmptyCatalog />}

        {!isFiltering && heroListings.length > 0 && (
          <StorefrontHero featured={heroListings} state={stateFor} onOpen={openListing} />
        )}

        {!isFiltering && !catalogIsEmpty && overview.page !== null && (
          <section className="space-y-4">
            <SectionHead
              title="Browse by category"
              subtitle="Everything the store sells"
              viewAllLabel="Browse everything"
              onViewAll={browseEverything}
            />
            <CategoryTiles
              counts={typeCounts}
              sample={categorySample}
              onSelect={(type) => navigate(marketplaceFilterPath({ type, category: ALL_CATEGORIES, browseAll: false }))}
            />
          </section>
        )}

        {!isFiltering && trendingRail.listings.length > 0 && (
          <section className="space-y-4">
            <SectionHead
              title={trendingRail.title}
              subtitle={trendingRail.subtitle}
              onViewAll={() => {
                setSort(trendingRail.sort);
                browseEverything();
              }}
            />
            <CardRail>
              {trendingRail.listings.map((listing) => (
                <div key={listing.id} className="snap-start">
                  <ListingCard
                    listing={listing}
                    state={stateFor(listing)}
                    badge={badgeFor(listing)}
                    size="rail"
                    onClick={() => openListing(listing.id)}
                    onAuthorClick={openAuthor}
                  />
                </div>
              ))}
            </CardRail>
          </section>
        )}

        {!isFiltering && whatsNew.length > 0 && (
          <section className="space-y-4">
            <SectionHead
              title="What's new"
              subtitle="Fresh drops from creators"
              onViewAll={() => {
                setSort("newest");
                browseEverything();
              }}
            />
            <ListingGrid
              listings={whatsNew}
              stateFor={stateFor}
              badgeFor={badgeFor}
              onOpen={openListing}
              onAuthor={openAuthor}
            />
          </section>
        )}

        {isFiltering && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
              {grid && (
                <span className="text-sm text-muted-foreground">
                  {grid.total} {grid.total === 1 ? "listing" : "listings"}
                </span>
              )}
              {results.loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as MarketplaceSort);
                  setOffset(0);
                }}
                aria-label="Sort results"
                className="ml-auto h-9 rounded-md border bg-background px-3 text-sm text-muted-foreground"
              >
                <option value="relevance">Sort: Best match</option>
                <option value="newest">Sort: Newest</option>
                <option value="trending">Sort: Trending this week</option>
                <option value="popular">Sort: Most installed</option>
                <option value="name">Sort: A–Z</option>
              </select>
            </div>

            {grid && grid.listings.length === 0 && !results.loading && (
              <StorefrontNoResults query={query} onClear={clearFilters} />
            )}

            {grid && grid.listings.length > 0 && (
              <>
                <ListingGrid
                  listings={grid.listings}
                  stateFor={stateFor}
                  badgeFor={badgeFor}
                  onOpen={openListing}
                  onAuthor={openAuthor}
                />
                {grid.total > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {offset + 1}–{Math.min(offset + grid.listings.length, grid.total)} of {grid.total}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + PAGE_SIZE >= grid.total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The store's header: one search box for the whole marketplace, and the
 * theme switch.
 *
 * It sticks because the search box is how a streamer leaves the front window,
 * and scrolling past it should not mean scrolling back up to search. The theme
 * switch is here rather than only in the account menu because this is the one
 * page in the app whose art is meant to be looked at in both themes.
 */
function StorefrontTopBar({
  query,
  onQueryChange,
  onRefresh,
  refreshing,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { mode, toggleMode } = useTheme();
  return (
    <div className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-md">
      <div className="flex w-full items-center gap-3 p-4 lg:px-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            // One box for the whole marketplace: name, description, author and
            // tags, across modules, themes, emotes, overlays and alerts.
            type="search"
            placeholder="Search modules, themes, emotes, overlays, alerts…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search the marketplace"
            className="h-11 rounded-xl pl-9 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          aria-label={mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
          onClick={toggleMode}
        >
          {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          aria-label="Reload the catalog"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}

/**
 * The storefront's grid: as many columns as fit the page's width.
 *
 * The minimum keeps each card's art large enough to be the product shot it is
 * meant to be, however wide the window is.
 */
function ListingGrid({
  listings,
  stateFor,
  badgeFor,
  onOpen,
  onAuthor,
}: {
  listings: readonly CatalogListing[];
  stateFor: (listing: CatalogListing) => ListingCardState;
  badgeFor: (listing: CatalogListing) => ListingBadge | null;
  onOpen: (id: string) => void;
  onAuthor: (slug: string) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
      {listings.map((listing) => (
        <ListingCard
          key={listing.id}
          listing={listing}
          state={stateFor(listing)}
          badge={badgeFor(listing)}
          onClick={() => onOpen(listing.id)}
          onAuthorClick={onAuthor}
        />
      ))}
    </div>
  );
}
