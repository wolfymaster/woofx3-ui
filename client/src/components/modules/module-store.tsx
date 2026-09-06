import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  getCategoryBannerStyle,
  getCategoryColor,
  getCategoryCounts,
  getCategoryIcon,
} from "@/components/modules/module-category";
import { ModuleStoreCard, type ModuleStoreCardData } from "@/components/modules/module-store-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInstance } from "@/hooks/use-instance";
import type { MarketplaceCatalog, MarketplaceListItem } from "@/hooks/use-marketplace-catalog";
import { cn, isNewerVersion } from "@/lib/utils";

const ALL_CATEGORIES = "all";
const RECENTLY_UPDATED_COUNT = 8;

interface ModuleStoreProps {
  catalog: MarketplaceCatalog;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export function ModuleStore({ catalog, selectedCategory, onSelectCategory }: ModuleStoreProps) {
  const { instance } = useInstance();
  const [, navigate] = useLocation();
  const { list: marketplaceList, loading: marketplaceLoading, error: marketplaceError, refetch } = catalog;

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip");
  const featured = useQuery(api.moduleFeatured.list, {});

  const installedVersionsByMarketplaceId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of repoModules || []) {
      if (m.moduleKey) {
        const parts = m.moduleKey.split(":");
        if (parts.length >= 2 && parts[0]) {
          map.set(parts[0], parts[1]);
        }
      }
    }
    return map;
  }, [repoModules]);

  const toCardData = useCallback(
    (m: MarketplaceListItem): ModuleStoreCardData => {
      const installedVersion = installedVersionsByMarketplaceId.get(m.id);
      return {
        id: m.id,
        name: m.name,
        author: m.author,
        description: m.description,
        version: m.version,
        category: m.category,
        iconUrl: m.iconUrl,
        isInstalled: installedVersion !== undefined,
        updateAvailable: installedVersion ? isNewerVersion(m.version, installedVersion) : false,
      };
    },
    [installedVersionsByMarketplaceId]
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "az">("newest");
  const [heroIndex, setHeroIndex] = useState(0);

  const query = searchQuery.toLowerCase().trim();
  const isFiltering = query.length > 0 || selectedCategory !== ALL_CATEGORIES;
  const showDiscover = !isFiltering;

  const categoryCounts = useMemo(() => getCategoryCounts(marketplaceList ?? []), [marketplaceList]);

  const filteredModules = useMemo(() => {
    if (!marketplaceList) return [];
    const filtered = marketplaceList.filter((m) => {
      if (selectedCategory !== ALL_CATEGORIES && m.category !== selectedCategory) {
        return false;
      }
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
      );
    });
    const sorted = [...filtered];
    if (sortBy === "az") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
    }
    return sorted;
  }, [marketplaceList, selectedCategory, query, sortBy]);

  const featuredModules = useMemo(() => {
    if (!marketplaceList || !featured || featured.length === 0) {
      return [];
    }
    const byId = new Map(marketplaceList.map((m) => [m.id, m] as const));
    return featured.map((f) => byId.get(f.moduleKey)).filter((m): m is MarketplaceListItem => m !== undefined);
  }, [marketplaceList, featured]);

  const recentlyUpdated = useMemo(() => {
    if (!marketplaceList) return [];
    return [...marketplaceList]
      .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
      .slice(0, RECENTLY_UPDATED_COUNT);
  }, [marketplaceList]);

  const hero = featuredModules.length > 0 ? featuredModules[heroIndex % featuredModules.length] : null;

  const handleSelect = useCallback((marketplaceId: string) => navigate(`/modules/${marketplaceId}`), [navigate]);

  const gridHeading = query.trim()
    ? "Search results"
    : selectedCategory === ALL_CATEGORIES
      ? "All modules"
      : selectedCategory;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-[1600px] mx-auto w-full p-6 lg:p-8 space-y-8">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${marketplaceList?.length ?? 0} modules...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "newest" | "az")}
            className="h-9 px-3 rounded-md border bg-background text-sm text-muted-foreground"
          >
            <option value="newest">Sort: Newest</option>
            <option value="az">Sort: A–Z</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            onClick={() => void refetch()}
            disabled={marketplaceLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", marketplaceLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {marketplaceError && (
          <div className="p-4 text-sm space-y-2 rounded-md border border-destructive/30 bg-destructive/5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="font-medium">Failed to load marketplace</span>
            </div>
            <p className="text-muted-foreground break-words">{marketplaceError}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        )}

        {marketplaceLoading && marketplaceList === null && (
          <div className="flex items-center justify-center min-h-[30vh]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {showDiscover && hero && (
          <div className="space-y-8">
            <div
              className="relative rounded-2xl overflow-hidden border h-64"
              style={getCategoryBannerStyle(hero.category)}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex flex-col justify-center max-w-lg px-8 gap-3">
                <span className="w-fit text-[11px] font-semibold tracking-wide px-2.5 py-1 rounded-full bg-primary/15 text-primary border border-primary/30">
                  FEATURED · {hero.category}
                </span>
                <h2 className="text-3xl font-bold leading-tight">{hero.name}</h2>
                <p className="text-sm text-muted-foreground line-clamp-2">{hero.description}</p>
                <div className="flex items-center gap-3 mt-1">
                  <Button onClick={() => handleSelect(hero.id)}>View Module</Button>
                  <span className="text-xs text-muted-foreground">by {hero.author || "Unknown"}</span>
                </div>
              </div>
              {featuredModules.length > 1 && (
                <div className="absolute bottom-4 left-8 flex items-center gap-1.5">
                  {featuredModules.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-label={`Show featured module ${i + 1}`}
                      onClick={() => setHeroIndex(i)}
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        i === heroIndex % featuredModules.length ? "w-6 bg-primary" : "w-1.5 bg-foreground/25"
                      )}
                    />
                  ))}
                </div>
              )}
              {featuredModules.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous featured module"
                    onClick={() => setHeroIndex((i) => (i - 1 + featuredModules.length) % featuredModules.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 -mt-5 h-8 w-8 rounded-full bg-background/70 backdrop-blur-sm border flex items-center justify-center hover:bg-background"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next featured module"
                    onClick={() => setHeroIndex((i) => (i + 1) % featuredModules.length)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 mt-5 h-8 w-8 rounded-full bg-background/70 backdrop-blur-sm border flex items-center justify-center hover:bg-background"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Featured this week
              </h2>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {featuredModules.map((m) => (
                  <ModuleStoreCard
                    key={m.id}
                    module={toCardData(m)}
                    size="featured"
                    onClick={() => handleSelect(m.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        )}

        {showDiscover && categoryCounts.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Browse by category</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {categoryCounts.map(({ category, count }) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => onSelectCategory(category)}
                  className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent text-left"
                >
                  <div
                    className="h-9 w-9 rounded-md flex items-center justify-center shrink-0 text-white"
                    style={{ backgroundColor: getCategoryColor(category) }}
                  >
                    {getCategoryIcon(category)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{category}</div>
                    <div className="text-xs text-muted-foreground">{count} modules</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {showDiscover && recentlyUpdated.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recently updated</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {recentlyUpdated.map((m) => (
                <ModuleStoreCard key={m.id} module={toCardData(m)} onClick={() => handleSelect(m.id)} />
              ))}
            </div>
          </section>
        )}

        {marketplaceList !== null && isFiltering && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{gridHeading}</h2>
              <span className="text-xs text-muted-foreground">
                {filteredModules.length} {filteredModules.length === 1 ? "module" : "modules"}
              </span>
            </div>
            {filteredModules.length === 0 ? (
              <div className="text-sm text-muted-foreground p-8 text-center">
                {query ? `No modules match "${searchQuery}".` : "No modules in this category."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredModules.map((m) => (
                  <ModuleStoreCard key={m.id} module={toCardData(m)} onClick={() => handleSelect(m.id)} />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
