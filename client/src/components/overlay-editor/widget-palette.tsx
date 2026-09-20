import { useMemo } from "react";
import { widgetIconFor } from "@/components/overlay-editor/widget-icon";
import { cn } from "@/lib/utils";
import { groupWidgetsByTaxonomy } from "@/lib/widget-groups";

/** The least a palette needs of a catalog row; both editors' rows satisfy it. */
export interface PaletteWidget {
  widgetId: string;
  name: string;
  taxonomy?: string[];
}

interface WidgetPaletteProps<T extends PaletteWidget> {
  widgets: readonly T[];
  onAdd: (widget: T) => void;
  /** `grid` for a vertical rail, `row` for the phone strip that scrolls sideways. */
  layout: "grid" | "row";
  /** What to say when nothing is installed; the two editors narrow to different surfaces. */
  emptyMessage: string;
}

/**
 * The widgets that can be added, as square tiles grouped by taxonomy family.
 *
 * One palette for both editors so the alert and scene canvases read as one
 * surface. Grouping is by declared taxonomy rather than owning module (see
 * lib/widget-groups.ts): every bundled widget ships from the one `woofx3`
 * module, so a module heading grouped nothing.
 *
 * The phone strip scrolls sideways as one row, so it drops the headings —
 * a heading per family would cost more width than the tiles it labels.
 */
export function WidgetPalette<T extends PaletteWidget>({
  widgets,
  onAdd,
  layout,
  emptyMessage,
}: WidgetPaletteProps<T>) {
  const groups = useMemo(() => groupWidgetsByTaxonomy(widgets), [widgets]);

  if (widgets.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <PaletteHeading>Add widget</PaletteHeading>
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </section>
    );
  }

  if (layout === "row") {
    return (
      <section className="flex min-w-0 flex-col gap-3">
        <PaletteHeading>Add widget</PaletteHeading>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {groups.flatMap((group) =>
            group.widgets.map((widget) => (
              <div key={widget.widgetId} className="w-[64px] shrink-0">
                <WidgetTile widget={widget} onAdd={onAdd} />
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-2">
          <PaletteHeading>{group.label}</PaletteHeading>
          <div className="grid grid-cols-2 gap-2">
            {group.widgets.map((widget) => (
              <WidgetTile key={widget.widgetId} widget={widget} onAdd={onAdd} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function PaletteHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{children}</h2>;
}

function WidgetTile<T extends PaletteWidget>({ widget, onAdd }: { widget: T; onAdd: (widget: T) => void }) {
  const Icon = widgetIconFor(widget.taxonomy);
  return (
    <button
      type="button"
      onClick={() => onAdd(widget)}
      title={widget.name}
      className={cn(
        "flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 p-2 text-xs",
        "hover:border-foreground/20 hover:bg-accent"
      )}
      data-testid={`add-widget-${widget.widgetId}`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/15 text-primary-text">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="w-full truncate text-center">{widget.name}</span>
    </button>
  );
}
