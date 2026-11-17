import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { widgetIconFor } from "@/components/overlay-editor/widget-icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { groupWidgetsIntoSections } from "@/lib/widget-groups";

/** The least a palette needs of a catalog row; both editors' rows satisfy it. */
export interface PaletteWidget {
  widgetId: string;
  name: string;
  description?: string;
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

const COLLAPSED_KEY = "woofx3:widget-palette:collapsed";

/** A reader's collapsed sections, kept across editors in this browser. */
function readCollapsed(): ReadonlySet<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(stored) ? new Set(stored.filter((key): key is string => typeof key === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * The widgets that can be added, as rows grouped by what their content is.
 *
 * One palette for both editors so the alert and scene canvases read as one
 * surface. Rows carry the catalog's own name and description instead of an icon:
 * a Database value draws text much like Text does, and only the description says
 * that its values come from a source and keep changing. Sections are plain
 * disclosures, not animated collapsibles: in a scrolling rail a closed section
 * should simply take no room. The phone strip scrolls sideways as one row, so it
 * drops the headings — a heading per section would cost more width than the
 * tiles it labels.
 */
export function WidgetPalette<T extends PaletteWidget>({
  widgets,
  onAdd,
  layout,
  emptyMessage,
}: WidgetPaletteProps<T>) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage can be blocked; the sections still collapse for this render.
    }
  }, [collapsed]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle === "") {
      return widgets;
    }
    return widgets.filter(
      (widget) =>
        widget.name.toLowerCase().includes(needle) || (widget.description?.toLowerCase().includes(needle) ?? false)
    );
  }, [widgets, needle]);
  const groups = useMemo(() => groupWidgetsIntoSections(visible), [visible]);

  const setSectionOpen = (key: string, open: boolean) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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
    <section className="flex min-w-0 flex-col gap-3">
      <PaletteHeading>Add widget</PaletteHeading>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search widgets"
          aria-label="Search widgets"
          className="h-8 pl-8 text-xs"
          data-testid="input-search-palette-widgets"
        />
      </div>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">No widgets match “{query.trim()}”.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {groups.map((group) => {
            // A search has to show its matches even in a section the reader closed earlier.
            const open = needle !== "" || !collapsed.has(group.key);
            const contentId = `widget-section-content-${group.key}`;
            return (
              <div key={group.key}>
                <button
                  type="button"
                  onClick={() => setSectionOpen(group.key, !open)}
                  aria-expanded={open}
                  aria-controls={contentId}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`widget-section-${group.key}`}
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{group.label}</span>
                  <span className="ml-auto text-[11px] font-normal">{group.widgets.length}</span>
                </button>
                <div id={contentId} hidden={!open} className={cn("flex-col gap-0.5 pt-0.5", open && "flex")}>
                  {group.widgets.map((widget) => (
                    <WidgetRow key={widget.widgetId} widget={widget} onAdd={onAdd} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PaletteHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-muted-foreground">{children}</h2>;
}

/** One catalog row: what it is, then why its content is different. No icon to learn. */
function WidgetRow<T extends PaletteWidget>({ widget, onAdd }: { widget: T; onAdd: (widget: T) => void }) {
  return (
    <button
      type="button"
      onClick={() => onAdd(widget)}
      title={widget.description ?? widget.name}
      className={cn(
        "w-full rounded-lg px-2 py-1.5 text-left",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      data-testid={`add-widget-${widget.widgetId}`}
    >
      <span className="block text-[13px] font-medium leading-snug text-foreground">{widget.name}</span>
      {widget.description && (
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2">
          {widget.description}
        </span>
      )}
    </button>
  );
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
