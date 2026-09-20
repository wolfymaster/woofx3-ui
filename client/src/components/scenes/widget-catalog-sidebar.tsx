import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import { Bell, Film, Image, Sparkles, Square, Type, Volume2 } from "lucide-react";
import { useMemo } from "react";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupWidgetsByTaxonomy } from "@/lib/widget-groups";

interface WidgetCatalogSidebarProps {
  catalogWidgets: SceneWidgetCatalogRow[];
  onAdd: (canonicalId: string, displayName: string) => void;
}

/**
 * The icon a widget's taxonomy family earns. Keyed on the declared axis rather
 * than the widget id, so a module's own video widget gets the film icon without
 * this list learning its name.
 */
const FAMILY_ICON: Record<string, typeof Square> = {
  alert: Bell,
  text: Type,
  "media.image": Image,
  "media.video": Film,
  "media.audio": Volume2,
  "media.animation": Sparkles,
};

function widgetIcon(widget: SceneWidgetCatalogRow): typeof Square {
  for (const entry of widget.taxonomy ?? []) {
    const icon = FAMILY_ICON[entry] ?? FAMILY_ICON[entry.split(".")[0]];
    if (icon) {
      return icon;
    }
  }
  return Square;
}

/**
 * Left sidebar for the scene editor: the installed widgets as square tiles,
 * grouped by taxonomy family, click to add to the canvas.
 *
 * Matches the alert editor's `WidgetTiles` — same tile, same section heading —
 * so the two editors read as one surface. Grouping is by declared taxonomy
 * (see lib/widget-groups.ts), not by owning module: every bundled widget ships
 * from the one `woofx3` module, so a module heading grouped nothing.
 */
export function WidgetCatalogSidebar({ catalogWidgets, onAdd }: WidgetCatalogSidebarProps) {
  const groups = useMemo(() => groupWidgetsByTaxonomy(catalogWidgets), [catalogWidgets]);

  return (
    <div className={SIDEBAR_RAIL}>
      <div className="h-12 flex items-center px-3 border-b shrink-0">
        <span className="text-sm font-medium">Widgets</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 p-3">
          {catalogWidgets.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No widgets installed yet.</p>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {group.label}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {group.widgets.map((widget) => {
                    const Icon = widgetIcon(widget);
                    return (
                      <button
                        type="button"
                        key={widget.widgetId}
                        className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 p-2 text-xs hover:border-foreground/20 hover:bg-accent"
                        onClick={() => onAdd(widget.widgetId, widget.name)}
                        data-testid={`button-add-${widget.widgetId}`}
                        title={widget.name}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/15 text-primary-text">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <span className="w-full truncate text-center">{widget.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
