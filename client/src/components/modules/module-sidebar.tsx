import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Check, Loader2, Store, Upload } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { getCategoryColor } from "@/components/modules/module-category";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstance } from "@/hooks/use-instance";
import { MARKETPLACE_PATH, MARKETPLACE_UPLOAD_PATH } from "@/lib/marketplace-route";
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
  marketplaceListingId?: string;
  archiveKey?: string;
}

/**
 * Where an installed module came from, as far as this dashboard knows: a
 * marketplace listing it was installed from, or an archive someone uploaded.
 * Null when neither is recorded.
 */
export type ModuleProvenance = "marketplace" | "uploaded";

export function moduleProvenance(module: {
  marketplaceListingId?: string;
  archiveKey?: string;
}): ModuleProvenance | null {
  if (module.marketplaceListingId) {
    return "marketplace";
  }
  return module.archiveKey ? "uploaded" : null;
}

const PROVENANCE_LABEL: { readonly [P in ModuleProvenance]: string } = {
  marketplace: "Marketplace",
  uploaded: "Uploaded",
};

interface ModuleSidebarProps {
  selectedId: Id<"moduleRepository"> | null;
  onSelectModule: (moduleId: Id<"moduleRepository">) => void;
}

/** The Marketplace tab's installed modules, and the ways to add one. */
export function ModuleSidebar({ selectedId, onSelectModule }: ModuleSidebarProps) {
  const { instance } = useInstance();
  const [, navigate] = useLocation();

  const repoModules = useQuery(api.moduleRepository.list, instance ? { instanceId: instance._id } : "skip") as
    | InstalledModuleItem[]
    | undefined;

  const installedModules = useMemo(() => (repoModules || []).filter((m) => m.status === "installed"), [repoModules]);

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
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => navigate(MARKETPLACE_UPLOAD_PATH)}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload a module
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
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
            const provenance = moduleProvenance(module);
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
                  <span className="text-[11px] text-muted-foreground truncate block">
                    v{module.version}
                    {provenance && ` · ${PROVENANCE_LABEL[provenance]}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
