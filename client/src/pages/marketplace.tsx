import { api } from "@convex/_generated/api";
import type { CatalogListing, ListingType } from "@convex/lib/marketplaceCatalog";
import { featuredInOrder } from "@convex/lib/marketplaceImages";
import { useQuery } from "convex/react";
import { Loader2, Moon, RefreshCw, Search, Sun } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageIntro } from "@/components/common/page-intro";
import { CategoryTiles } from "@/components/marketplace/category-tiles";
import { ListingCard, type ListingCardState } from "@/components/marketplace/listing-card";
import {
  ALL_CATEGORIES,
  countByType,
  MarketplaceSidebar,
  moduleCategories,
} from "@/components/marketplace/marketplace-sidebar";
import { StorefrontHero } from "@/components/marketplace/storefront-hero";
import { CardRail, SectionHead } from "@/components/marketplace/storefront-section";
import {
  StorefrontEmptyCatalog,
  StorefrontError,
  StorefrontNoResults,
} from "@/components/marketplace/storefront-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/hooks/use-instance";
import {
  type MarketplaceSort,
  useDebounced,
  useMarketplaceCounts,
  useMarketplaceEntitlements,
  useMarketplaceSearch,
} from "@/hooks/use-marketplace";
import { useTheme } from "@/hooks/use-theme";
import { bestsellerFloor, type ListingBadge, listingBadge } from "@/lib/listing-signals";
import { listingTypeMeta } from "@/lib/listing-type";
import { marketplaceAuthorPath, marketplaceListingPath } from "@/lib/marketplace-route";
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

/** How much of the catalog the overview reads. Matches the API's page cap. */
const OVERVIEW_LIMIT = 200;
/** Featured slots the hero can fill: one large, two small. */
const HERO_COUNT = 3;
const TRENDING_COUNT = 10;
const WHATS_NEW_COUNT = 12;
const PAGE_SIZE = 24;

export default function Marketplace() {
  const { instance } = useInstance();
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = useMemo(() => new URLSearchParams(searchString), [searchString]);

  const selectedCategory = params.get("category") ?? ALL_CATEGORIES;
  const selectedType = (params.get("type") as ListingType | null) ?? null;
  // What a section's "view all" opens: the whole catalog as one paged grid,
  // with no type or category narrowing it. In the URL so it survives a reload
  // and a back button, like every other thing the page is showing.
  const browseAll = params.get("browse") === "all";

  const [queryInput, setQueryInput] = useState("");
  const [sort, setSort] = useState<MarketplaceSort>("relevance");
  const [offset, setOffset] = useState(0);
  const query = useDebounced(queryInput).trim();

  // Changing what is being looked at starts the page over; staying on page 3
  // of a different result set shows an empty grid for no visible reason.
  const setFilter = useCallback(
    (next: { type?: ListingType | null; category?: string; browseAll?: boolean }) => {
      const updated = new URLSearchParams();
      const type = next.type !== undefined ? next.type : selectedType;
      const category = next.category !== undefined ? next.category : selectedCategory;
      const browse = next.browseAll !== undefined ? next.browseAll : browseAll;
      if (type) {
        updated.set("type", type);
      }
      if (category !== ALL_CATEGORIES) {
        updated.set("category", category);
      }
      // Only when nothing else narrows the grid: a type or a category already
      // opens it, and two things saying "show the grid" can disagree.
      if (browse && !type && category === ALL_CATEGORIES) {
        updated.set("browse", "all");
      }
      const encoded = updated.toString();
      setOffset(0);
      navigate(encoded === "" ? "/marketplace" : `/marketplace?${encoded}`);
    },
    [navigate, browseAll, selectedCategory, selectedType]
  );

  const instanceId = instance?._id ?? null;
  const isFiltering = query !== "" || selectedType !== null || selectedCategory !== ALL_CATEGORIES || browseAll;
  // The storefront's own sections are not fetched while a search is on screen.
  // Passing null holds what they already fetched rather than discarding it, so
  // clearing the search box puts the front window back without a round trip.
  const storefrontId = isFiltering ? null : instanceId;

  // The overview is the one read that describes the whole catalog rather than
  // one section of it: the sidebar's counts and categories have to stay still
  // while the grid is filtered, and "what's new" is its first page, since the
  // overview is already newest-first.
  const overview = useMarketplaceSearch(instanceId, {
    query: "",
    types: [],
    sort: "newest",
    limit: OVERVIEW_LIMIT,
  });

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

  const counts = useMarketplaceCounts(storefrontId);

  const results = useMarketplaceSearch(isFiltering ? instanceId : null, {
    query,
    types: selectedType ? [selectedType] : [],
    category: selectedCategory === ALL_CATEGORIES ? undefined : selectedCategory,
    sort,
    limit: PAGE_SIZE,
    offset,
  });

  const entitlements = useMarketplaceEntitlements(instanceId);
  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");

  // moduleKey is `{marketplaceId}:{version}:{sha7}`, so the installed version
  // of a marketplace listing is read off its prefix.
  const installedVersions = useMemo(() => {
    const map = new Map<string, string>();
    for (const module of repoModules ?? []) {
      const parts = module.moduleKey?.split(":");
      if (parts && parts.length >= 2 && parts[0]) {
        map.set(parts[0], parts[1]);
      }
    }
    return map;
  }, [repoModules]);

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
  const typeCounts = useMemo(() => countByType(all), [all]);
  const categories = useMemo(() => moduleCategories(all), [all]);

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
    setFilter({ type: null, category: ALL_CATEGORIES, browseAll: false });
  }, [setFilter]);

  /** What a section's "view all" does: open the whole catalog as a grid. */
  const browseEverything = useCallback(() => {
    setQueryInput("");
    setFilter({ type: null, category: ALL_CATEGORIES, browseAll: true });
  }, [setFilter]);

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
    <div className="flex h-full w-full max-w-[1600px] overflow-hidden">
      <MarketplaceSidebar
        typeCounts={counts.counts ?? typeCounts}
        categories={categories}
        total={overview.page?.total ?? 0}
        selectedType={selectedType}
        selectedCategory={selectedCategory}
        onSelectType={(type) => setFilter({ type })}
        onSelectCategory={(category) => setFilter({ category })}
      />

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

        <div className="mx-auto w-full max-w-[1600px] space-y-12 p-6 lg:p-8">
          <PageIntro introId="modules" onTry={() => setFilter({ type: "emote", category: ALL_CATEGORIES })} />

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
                counts={counts.counts ?? typeCounts}
                sample={categorySample}
                onSelect={(type) => setFilter({ type, category: ALL_CATEGORIES })}
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
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 p-4 lg:px-8">
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
 * The storefront's grid: four columns at most.
 *
 * Five columns of small cards is what made the old grid read as a table of
 * rows; four at this width gives the art enough room to be the product shot it
 * is meant to be.
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
