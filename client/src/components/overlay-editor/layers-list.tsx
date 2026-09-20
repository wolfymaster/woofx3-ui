import { widgetIconFor } from "@/components/overlay-editor/widget-icon";
import { cn } from "@/lib/utils";
import type { Widget } from "@/types";

interface LayersListProps {
  /** Already ordered the way the editor wants them read; this does not sort. */
  layers: readonly Widget[];
  selectedId: string | null;
  /** The label a layer goes by, shared with the canvas so both name it the same. */
  label: (widget: Widget) => string;
  /** The widget's taxonomy, looked up from the editor's catalog, for the icon. */
  taxonomyOf: (widget: Widget) => string[] | undefined;
  /** Trailing note, e.g. an alert layer's length. Omitted where a layer has no such axis. */
  meta?: (widget: Widget) => string;
  onSelect: (widgetId: string) => void;
  /** The phone layout lays the layers out as one sideways-scrolling row. */
  horizontal?: boolean;
  emptyMessage: string;
}

/**
 * The layers on the canvas, in the order the editor hands them over; picking
 * one selects it on the canvas.
 *
 * Shared by both editors. `meta` is the one axis they differ on — an alert
 * layer has a length, a scene widget does not — so it is a slot rather than a
 * flag, and a scene simply passes none.
 */
export function LayersList({
  layers,
  selectedId,
  label,
  taxonomyOf,
  meta,
  onSelect,
  horizontal = false,
  emptyMessage,
}: LayersListProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Layers</h2>
      {layers.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className={cn(horizontal ? "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" : "flex flex-col gap-1")}>
          {layers.map((widget) => {
            const Icon = widgetIconFor(taxonomyOf(widget));
            const isSelected = widget.id === selectedId;
            const note = meta?.(widget);
            return (
              <button
                key={widget.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(widget.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 text-left text-sm hover:bg-accent",
                  horizontal ? "h-11 max-w-[220px] rounded-full border px-3" : "min-h-9 rounded-lg px-2 py-1.5",
                  isSelected && "bg-accent ring-2 ring-inset ring-primary"
                )}
                data-testid={`layer-${widget.id}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label(widget)}</span>
                {note ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{note}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
