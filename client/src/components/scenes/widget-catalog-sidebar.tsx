import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import { Square } from "lucide-react";
import { useMemo } from "react";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { ScrollArea } from "@/components/ui/scroll-area";

interface WidgetCatalogSidebarProps {
  catalogWidgets: SceneWidgetCatalogRow[];
  onAdd: (canonicalId: string, displayName: string) => void;
}

/** Left sidebar for the scene editor: installed widgets grouped by their owning module,
 * click to add to the canvas. Mirrors ScenesSidebar's row styling and ActionPickerDialog's
 * grouped-section heading treatment. */
export function WidgetCatalogSidebar({ catalogWidgets, onAdd }: WidgetCatalogSidebarProps) {
  const groups = useMemo(() => {
    const byModule = new Map<string, SceneWidgetCatalogRow[]>();
    for (const widget of catalogWidgets) {
      const existing = byModule.get(widget.moduleName);
      if (existing) {
        existing.push(widget);
      } else {
        byModule.set(widget.moduleName, [widget]);
      }
    }
    return Array.from(byModule.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalogWidgets]);

  return (
    <div className={SIDEBAR_RAIL}>
      <div className="h-12 flex items-center px-3 border-b shrink-0">
        <span className="text-sm font-medium">Widgets</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-4">
          {catalogWidgets.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No widgets installed yet.</p>
          ) : (
            groups.map(([moduleName, widgets]) => (
              <div key={moduleName}>
                <h3 className="px-2 mb-1 text-xs font-medium text-muted-foreground">{moduleName}</h3>
                <div className="space-y-1">
                  {widgets.map((widget) => (
                    <button
                      type="button"
                      key={widget.widgetId}
                      className="w-full text-left flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent"
                      onClick={() => onAdd(widget.widgetId, widget.name)}
                      data-testid={`button-add-${widget.widgetId}`}
                    >
                      <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                        <Square className="h-3.5 w-3.5" />
                      </div>
                      <span className="text-sm truncate">{widget.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
