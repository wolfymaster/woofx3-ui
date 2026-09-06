import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Check, Loader2, Store } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { getCategoryColor, getCategoryCounts } from "@/components/modules/module-category";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import type { MarketplaceListItem } from "@/hooks/use-marketplace-catalog";
import { cn } from "@/lib/utils";

export interface InstalledModuleItem {
  _id: Id<"moduleRepository">;
  name: string;
  description: string;
  version: string;
  tags: string[];
  author: string;
  category?: string;
  moduleKey?: string;
  isInstalled: boolean;
  status?: "pending" | "delivering" | "installed" | "failed";
}

const ALL_CATEGORIES = "all";

interface ModuleSidebarProps {
  catalog: MarketplaceListItem[] | null;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  selectedId: Id<"moduleRepository"> | null;
  onSelectModule: (moduleId: Id<"moduleRepository">) => void;
}

export function ModuleSidebar({
  catalog,
  selectedCategory,
  onSelectCategory,
  selectedId,
  onSelectModule,
}: ModuleSidebarProps) {
  const { instance } = useInstance();
  const [, navigate] = useLocation();

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip") as
    | InstalledModuleItem[]
    | undefined;

  const installedModules = useMemo(() => (repoModules || []).filter((m) => m.status === "installed"), [repoModules]);
  const categoryCounts = useMemo(() => getCategoryCounts(catalog ?? []), [catalog]);
  const totalCount = catalog?.length ?? 0;

  return (
    <div className="w-64 shrink-0 border-r bg-background flex flex-col">
      <div className="p-2 border-b">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => navigate("/modules")}>
          <Store className="h-3.5 w-3.5" />
          Browse Store
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Categories
          </div>
          <button
            type="button"
            onClick={() => onSelectCategory(ALL_CATEGORIES)}
            className={cn(
              "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent",
              selectedCategory === ALL_CATEGORIES && "bg-accent font-medium"
            )}
          >
            <span>All Modules</span>
            <span className="text-[11px] text-muted-foreground">{totalCount}</span>
          </button>
          {categoryCounts.map(({ category, count }) => (
            <button
              key={category}
              type="button"
              onClick={() => onSelectCategory(category)}
              className={cn(
                "w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm cursor-pointer hover:bg-accent",
                selectedCategory === category && "bg-accent font-medium"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="h-1.5 w-1.5 rounded-sm shrink-0"
                  style={{ backgroundColor: getCategoryColor(category) }}
                />
                <span className="truncate">{category}</span>
              </span>
              <span className="text-[11px] text-muted-foreground shrink-0">{count}</span>
            </button>
          ))}

          <div className="h-px bg-border my-3 mx-1" />

          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Installed ({installedModules.length})
          </div>
          {repoModules === undefined && (
            <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          )}
          {repoModules !== undefined && installedModules.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 text-center">No installed modules</div>
          )}
          {installedModules.map((module) => {
            const isSelected = selectedId === module._id;
            return (
              <button
                key={module._id}
                type="button"
                aria-pressed={isSelected}
                aria-label={`Select module ${module.name}`}
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left cursor-pointer hover:bg-accent",
                  isSelected && "bg-accent"
                )}
                onClick={() => onSelectModule(module._id)}
              >
                <div
                  className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 text-[11px] font-bold text-white"
                  style={{ backgroundColor: getCategoryColor(module.category) }}
                >
                  {module.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{module.name}</span>
                    {module.isInstalled && <Check className="h-3 w-3 text-green-500 shrink-0" />}
                    {module.status === "delivering" && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate block">v{module.version}</span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
