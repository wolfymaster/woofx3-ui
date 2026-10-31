import { Loader2, Store, Upload } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { getCategoryColor } from "@/components/modules/module-category";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInstalledModules } from "@/engine/hooks/use-modules";
import type { ModuleId, ModuleProvenance } from "@/engine/types";
import { useMarketplaceMode } from "@/lib/marketplace-mode";
import { MARKETPLACE_PATH, MARKETPLACE_UPLOAD_PATH } from "@/lib/marketplace-route";
import { cn } from "@/lib/utils";

const PROVENANCE_LABEL: { readonly [P in ModuleProvenance]: string } = {
  builtIn: "Built in",
  marketplace: "Marketplace",
  uploaded: "Uploaded",
};

interface ModuleSidebarProps {
  selectedId: ModuleId | null;
  onSelectModule: (moduleId: ModuleId) => void;
}

/** The Marketplace tab's installed modules, and the ways to add one. */
export function ModuleSidebar({ selectedId, onSelectModule }: ModuleSidebarProps) {
  const [, navigate] = useLocation();
  const { uploads } = useMarketplaceMode();
  const modules = useInstalledModules();

  const installedModules = useMemo(() => (modules ?? []).filter((m) => m.status === "installed"), [modules]);

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
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Installed ({installedModules.length})
          </div>
          {modules === undefined && (
            <div className="text-xs text-muted-foreground p-3 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          )}
          {modules !== undefined && installedModules.length === 0 && (
            <div className="text-xs text-muted-foreground p-3 text-center">No installed modules</div>
          )}
          {installedModules.map((module) => {
            const isSelected = selectedId === module.id;
            const provenance = module.provenance;
            return (
              <button
                key={module.id}
                type="button"
                aria-pressed={isSelected}
                aria-label={`Select module ${module.name}`}
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left cursor-pointer hover:bg-accent",
                  isSelected && "bg-accent"
                )}
                onClick={() => onSelectModule(module.id)}
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
