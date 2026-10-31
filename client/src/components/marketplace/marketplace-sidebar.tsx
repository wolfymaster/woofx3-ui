import type { CatalogListing, ListingType } from "@shared/marketplace-catalog";
import { LISTING_TYPES } from "@shared/marketplace-catalog";
import { PackageCheck, Store, Upload } from "lucide-react";
import { useLocation } from "wouter";
import { HelpTip } from "@/components/common/help-tip";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { getCategoryColor } from "@/components/modules/module-category";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstalledModules } from "@/engine/hooks/use-modules";
import { listingTypeColor, listingTypeIcon, listingTypeMeta } from "@/lib/listing-type";
import { useMarketplaceMode } from "@/lib/marketplace-mode";
import {
  ALL_CATEGORIES,
  MARKETPLACE_INSTALLED_PATH,
  MARKETPLACE_PATH,
  MARKETPLACE_UPLOAD_PATH,
  marketplaceFilterPath,
} from "@/lib/marketplace-route";
import { cn } from "@/lib/utils";

/**
 * A browsable category: either one of the five listing types, or a free-text
 * module category from a manifest.
 */
export interface CategoryEntry {
  /** What goes in the `category`/`type` filter. */
  key: string;
  label: string;
  count: number;
  color: string;
  icon?: React.ReactNode;
  /** A type filters by type; a category filters by category. */
  kind: "type" | "category";
}

interface MarketplaceSidebarProps {
  /** Type counts, from the whole catalog rather than the visible page. */
  typeCounts: Record<ListingType, number>;
  /** Module categories, derived from whatever the catalog returned. */
  categories: CategoryEntry[];
  total: number;
  /** What the storefront is narrowed to, or null on a page that is not the storefront, where nothing is selected. */
  selection: { type: ListingType | null; category: string } | null;
}

/**
 * The marketplace's category rail.
 *
 * Listing types come first and are a fixed, closed set with real icons, so
 * "Emotes" and "Overlays" sit beside each other in the same order every time.
 * Module categories follow: those are free text from manifests, so they keep
 * the hash-derived colour the module store has always used and appear only
 * when something is in them.
 */
export function MarketplaceSidebar({ typeCounts, categories, total, selection }: MarketplaceSidebarProps) {
  const [, navigate] = useLocation();
  const selectedType = selection?.type ?? null;
  const selectedCategory = selection?.category ?? ALL_CATEGORIES;
  const nothingSelected = selection !== null && selectedType === null && selectedCategory === ALL_CATEGORIES;
  const { uploads } = useMarketplaceMode();
  const installedCount = (useInstalledModules() ?? []).filter((module) => module.status === "installed").length;

  return (
    <div className={SIDEBAR_RAIL}>
      <div className="p-2 border-b flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => navigate(MARKETPLACE_PATH)}
        >
          <Store className="h-3.5 w-3.5" />
          Browse Marketplace
        </Button>
        {uploads && (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => navigate(MARKETPLACE_UPLOAD_PATH)}
          >
            <Upload className="h-3.5 w-3.5" />
            Upload a module
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <RailButton
            label="Installed"
            count={installedCount}
            selected={false}
            icon={<PackageCheck className="h-3 w-3" />}
            title="Modules installed on your engine, from the marketplace or uploaded"
            onClick={() => navigate(MARKETPLACE_INSTALLED_PATH)}
          />
          <div className="h-px bg-border my-3 mx-1" />
          <div className="flex items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Browse
            <HelpTip term="module" />
          </div>

          <RailButton
            label="Everything"
            count={total}
            selected={nothingSelected}
            onClick={() => navigate(MARKETPLACE_PATH)}
          />

          {LISTING_TYPES.map((type) => {
            const meta = listingTypeMeta(type);
            return (
              <RailButton
                key={type}
                label={meta.plural}
                count={typeCounts[type] ?? 0}
                selected={selectedType === type}
                color={listingTypeColor(type)}
                icon={listingTypeIcon(type, "h-3 w-3")}
                title={meta.blurb}
                onClick={() =>
                  navigate(
                    marketplaceFilterPath({
                      type: selectedType === type ? null : type,
                      category: ALL_CATEGORIES,
                      browseAll: false,
                    })
                  )
                }
              />
            );
          })}

          {categories.length > 0 && (
            <>
              <div className="h-px bg-border my-3 mx-1" />
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Categories
              </div>
              {categories.map((category) => (
                <RailButton
                  key={category.key}
                  label={category.label}
                  count={category.count}
                  selected={selectedCategory === category.key}
                  color={category.color}
                  onClick={() =>
                    navigate(
                      marketplaceFilterPath({
                        type: null,
                        category: selectedCategory === category.key ? ALL_CATEGORIES : category.key,
                        browseAll: false,
                      })
                    )
                  }
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function RailButton({
  label,
  count,
  selected,
  color,
  icon,
  title,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  color?: string;
  icon?: React.ReactNode;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent",
        selected && "bg-accent font-medium"
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon ? (
          <span className="shrink-0" style={{ color }}>
            {icon}
          </span>
        ) : (
          color && <span className="h-1.5 w-1.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="text-[11px] text-muted-foreground shrink-0">{count}</span>
    </button>
  );
}

/**
 * Module categories, counted from the catalog.
 *
 * The non-module types already appear as types in the rail above, so listing
 * them again as categories would double every emote pack. Only module and
 * theme listings contribute.
 */
export function moduleCategories(listings: readonly CatalogListing[]): CategoryEntry[] {
  const counts = new Map<string, number>();
  for (const listing of listings) {
    if (listing.type !== "module" || !listing.category) {
      continue;
    }
    counts.set(listing.category, (counts.get(listing.category) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({
      key: category,
      label: category,
      count,
      color: getCategoryColor(category),
      kind: "category" as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** How many listings of each type the catalog holds. */
export function countByType(listings: readonly CatalogListing[]): Record<ListingType, number> {
  const counts: Record<ListingType, number> = { module: 0, theme: 0, emote: 0, overlay: 0, alert: 0 };
  for (const listing of listings) {
    counts[listing.type] += 1;
  }
  return counts;
}
