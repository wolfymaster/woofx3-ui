import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import {
  AlertCircle,
  Bell,
  Check,
  Loader2,
  MessageSquare,
  Music,
  Puzzle,
  RefreshCw,
  Search,
  Video,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useInstance } from "@/hooks/use-instance";
import { cn } from "@/lib/utils";

type ModuleRepoItem = {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  status?: "pending" | "delivering" | "installed" | "failed";
  statusMessage?: string;
  installedAt?: number;
};

const categoryIcons: Record<string, React.ReactNode> = {
  Chat: <MessageSquare className="h-3.5 w-3.5" />,
  Alerts: <Bell className="h-3.5 w-3.5" />,
  Media: <Video className="h-3.5 w-3.5" />,
  Audio: <Music className="h-3.5 w-3.5" />,
  Automation: <Zap className="h-3.5 w-3.5" />,
  Integrations: <Puzzle className="h-3.5 w-3.5" />,
  Effects: <Puzzle className="h-3.5 w-3.5" />,
  Utilities: <Puzzle className="h-3.5 w-3.5" />,
};

function getCategoryIcon(category: string) {
  return categoryIcons[category] || <Puzzle className="h-3.5 w-3.5" />;
}

export interface ModuleListItem {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category: string;
  moduleKey?: string;
  isInstalled: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
}

export interface MarketplaceListItem {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  counts: { triggers: number; actions: number; functions: number; widgets: number };
  updatedAt?: string;
}

export type SelectedModule =
  | { source: "installed"; module: ModuleListItem }
  | { source: "marketplace"; marketplaceId: string };

interface ModulesSidebarProps {
  selected: SelectedModule | null;
  onSelectModule: (selection: SelectedModule | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function ModulesSidebar({ selected, onSelectModule, searchQuery, onSearchChange }: ModulesSidebarProps) {
  const { instance } = useInstance();

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip") as
    | ModuleRepoItem[]
    | undefined;

  const installedModules: ModuleListItem[] = useMemo(() => {
    return (repoModules || []).map((m) => ({
      _id: m._id,
      name: m.name,
      description: m.description,
      version: m.version,
      tags: m.tags,
      author: m.author,
      category: m.category,
      moduleKey: m.moduleKey,
      isInstalled: m.status === "installed",
      status: m.status,
    }));
  }, [repoModules]);

  const installedKeyPrefixes = useMemo(() => {
    const set = new Set<string>();
    for (const m of installedModules) {
      if (m.moduleKey) {
        const parts = m.moduleKey.split(":");
        if (parts.length >= 2) {
          set.add(`${parts[0]}:${parts[1]}`);
        }
      }
    }
    return set;
  }, [installedModules]);

  const isInstalledMarketplace = useCallback(
    (marketplaceId: string, version: string) => installedKeyPrefixes.has(`${marketplaceId}:${version}`),
    [installedKeyPrefixes]
  );

  const listMarketplace = useAction(api.marketplace.listModules);
  const [marketplaceList, setMarketplaceList] = useState<MarketplaceListItem[] | null>(null);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);

  const fetchMarketplace = useCallback(async () => {
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const list = await listMarketplace();
      setMarketplaceList(list);
    } catch (err) {
      setMarketplaceError(err instanceof Error ? err.message : "Failed to load marketplace.");
    } finally {
      setMarketplaceLoading(false);
    }
  }, [listMarketplace]);

  useEffect(() => {
    if (marketplaceList === null && !marketplaceLoading && !marketplaceError) {
      void fetchMarketplace();
    }
  }, [marketplaceList, marketplaceLoading, marketplaceError, fetchMarketplace]);

  const query = searchQuery.toLowerCase().trim();

  const filteredMarketplace = useMemo(() => {
    if (!marketplaceList) return [];
    if (!query) return marketplaceList;
    return marketplaceList.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.category.toLowerCase().includes(query)
    );
  }, [marketplaceList, query]);

  const filteredInstalled = useMemo(() => {
    if (!query) {
      return installedModules.filter((m) => m.isInstalled);
    }
    return installedModules.filter(
      (m) =>
        m.isInstalled &&
        (m.name.toLowerCase().includes(query) ||
          m.description.toLowerCase().includes(query) ||
          m.category.toLowerCase().includes(query))
    );
  }, [installedModules, query]);

  const searchResults = useMemo(() => {
    if (!query || !marketplaceList) return null;
    const results: Array<{
      id: string;
      name: string;
      description: string;
      version: string;
      author: string;
      category: string;
      tags: string[];
      isInstalled: boolean;
      iconUrl?: string;
    }> = [];
    const seen = new Set<string>();

    for (const m of filteredMarketplace) {
      results.push({
        id: m.id,
        name: m.name,
        description: m.description,
        version: m.version,
        author: m.author,
        category: m.category,
        tags: m.tags,
        isInstalled: isInstalledMarketplace(m.id, m.version),
        iconUrl: m.iconUrl,
      });
      seen.add(m.id);
    }

    for (const m of filteredInstalled) {
      const mpId = m.moduleKey?.split(":")[0];
      if (mpId && seen.has(mpId)) continue;
      results.push({
        id: m._id,
        name: m.name,
        description: m.description,
        version: m.version,
        author: m.author,
        category: m.category,
        tags: m.tags,
        isInstalled: true,
      });
    }

    return results;
  }, [query, marketplaceList, filteredMarketplace, filteredInstalled, isInstalledMarketplace]);

  const selectedInstalledId = selected?.source === "installed" ? selected.module._id : null;
  const selectedMarketplaceId = selected?.source === "marketplace" ? selected.marketplaceId : null;

  const isSearching = query.length > 0;
  const marketplaceCount = marketplaceList?.length ?? 0;
  const installedCount = installedModules.filter((m) => m.isInstalled).length;

  return (
    <div className="w-72 shrink-0 border-r bg-background flex flex-col">
      <div className="p-2 border-b flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search modules..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 text-xs pl-7"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => void fetchMarketplace()}
          disabled={marketplaceLoading}
          aria-label="Refresh marketplace"
          title="Refresh marketplace"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", marketplaceLoading && "animate-spin")} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isSearching ? (
            <>
              {searchResults === null ? (
                <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-xs text-muted-foreground p-3 text-center">No modules found</div>
              ) : (
                <>
                  <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Search Results ({searchResults.length})
                  </div>
                  {searchResults.map((item) => {
                    const isSelected = selectedMarketplaceId === item.id || selectedInstalledId === item.id;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        aria-label={`Select module ${item.name}`}
                        className={cn(
                          "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                          isSelected && "bg-accent"
                        )}
                        onClick={() => onSelectModule({ source: "marketplace", marketplaceId: item.id })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectModule({ source: "marketplace", marketplaceId: item.id });
                          }
                        }}
                      >
                        <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary overflow-hidden">
                          {item.iconUrl ? (
                            <img src={item.iconUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            getCategoryIcon(item.category)
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{item.name}</span>
                            {item.isInstalled && (
                              <Badge variant="secondary" className="text-[9px] py-0 px-1 shrink-0">
                                Installed
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground truncate block">
                            v{item.version} · {item.category}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
              {marketplaceError && (
                <div className="p-3 text-xs space-y-2 rounded-md border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">Failed to load</span>
                  </div>
                  <p className="text-muted-foreground break-words">{marketplaceError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void fetchMarketplace()}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* ── Marketplace section ── */}
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Browse ({marketplaceCount})
              </div>
              {marketplaceLoading && marketplaceList === null && (
                <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading marketplace…
                </div>
              )}
              {marketplaceError && (
                <div className="p-3 text-xs space-y-2 rounded-md border border-destructive/30 bg-destructive/5">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">Failed to load marketplace</span>
                  </div>
                  <p className="text-muted-foreground break-words">{marketplaceError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void fetchMarketplace()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!marketplaceLoading && !marketplaceError && marketplaceCount === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">No modules available</div>
              )}
              {filteredMarketplace.map((module) => {
                const isSelected = selectedMarketplaceId === module.id;
                const alreadyInstalled = isInstalledMarketplace(module.id, module.version);
                return (
                  <div
                    key={module.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Select marketplace module ${module.name}`}
                    className={cn(
                      "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                      isSelected && "bg-accent"
                    )}
                    onClick={() => onSelectModule({ source: "marketplace", marketplaceId: module.id })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectModule({ source: "marketplace", marketplaceId: module.id });
                      }
                    }}
                  >
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary overflow-hidden">
                      {module.iconUrl ? (
                        <img src={module.iconUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        getCategoryIcon(module.category)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{module.name}</span>
                        {alreadyInstalled && (
                          <Badge variant="secondary" className="text-[9px] py-0 px-1 shrink-0">
                            Installed
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground truncate block">
                        v{module.version} · {module.category}
                      </span>
                    </div>
                  </div>
                );
              })}

              <Separator className="my-2" />

              {/* ── Installed section ── */}
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Installed ({installedCount})
              </div>
              {repoModules === undefined && (
                <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              )}
              {repoModules !== undefined && installedCount === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">No installed modules</div>
              )}
              {filteredInstalled.map((module) => {
                const isSelected = selectedInstalledId === module._id;
                return (
                  <div
                    key={module._id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`Select module ${module.name}`}
                    className={cn(
                      "group flex items-start gap-2 rounded-md px-2 py-2 cursor-pointer hover:bg-accent",
                      isSelected && "bg-accent"
                    )}
                    onClick={() => onSelectModule({ source: "installed", module })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectModule({ source: "installed", module });
                      }
                    }}
                  >
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                      {getCategoryIcon(module.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{module.name}</span>
                        {module.isInstalled && <Check className="h-3 w-3 text-green-500 shrink-0" />}
                        {module.status === "delivering" && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground truncate block">
                        v{module.version} · {module.category}
                      </span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
