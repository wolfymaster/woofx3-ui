import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { widgetIconFor } from "@/components/overlay-editor/widget-icon";
import {
  pushRecentWidget,
  RECENT_SECTION_KEY,
  RECENT_SECTION_LABEL,
  readRecentIds,
  recentWidgetsOf,
  writeRecentIds,
} from "@/components/overlay-editor/widget-palette-recent";
import { type WidgetPreviewKind, widgetPreviewFor } from "@/components/overlay-editor/widget-preview";
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
    // Collapse state is a view-only preference; a blocked or malformed value
    // must not keep the palette from rendering.
    return new Set();
  }
}

/**
 * The widgets that can be added, as a shelf of preview tiles grouped by purpose.
 *
 * One palette for both editors so the alert and scene canvases read as one
 * surface. Each tile shows a sample of the widget's content — `Aa`, `{value}`,
 * `00:42`, a wordmark — rather than a category icon: a Database value draws text
 * much like Text does, and only the sample says its values come from a source.
 * The full name sits under the sample; the catalog description stays in the
 * tooltip, where a long sentence does not turn the rail into a settings list.
 * The last few additions get a Recent section above the taxonomy sections, so
 * a second pass through the library starts where the first one left off.
 * Sections are plain disclosures, not animated collapsibles: in a scrolling rail
 * a closed section should simply take no room. The phone strip keeps icon tiles
 * and drops the headings — the strip is narrow and scrolls, so a heading per
 * section would cost more width than the tiles it labels.
 */
// stylegate:ignore TS-NAM-001 reason="Repo convention names component files in kebab-case; renaming this shared palette would break every import for no gain."
export function WidgetPalette<T extends PaletteWidget>({
  widgets,
  onAdd,
  layout,
  emptyMessage,
}: WidgetPaletteProps<T>) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsed);
  const [recentIds, setRecentIds] = useState<string[]>(readRecentIds);

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

  useEffect(() => writeRecentIds(recentIds), [recentIds]);

  const addWidget = (widget: T) => {
    setRecentIds((current) => pushRecentWidget(current, widget.widgetId));
    onAdd(widget);
  };

  const recentWidgets = useMemo(() => recentWidgetsOf(recentIds, widgets), [recentIds, widgets]);
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
  const groups = useMemo(() => {
    const sections = groupWidgetsIntoSections(visible);
    // A search already shows each match in its own section; repeating it under
    // Recent would make the filtered rail look twice as long as it is.
    if (needle !== "" || recentWidgets.length === 0) {
      return sections;
    }
    return [{ key: RECENT_SECTION_KEY, label: RECENT_SECTION_LABEL, widgets: recentWidgets }, ...sections];
  }, [visible, needle, recentWidgets]);

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
          {groups
            .filter((group) => group.key !== RECENT_SECTION_KEY)
            .flatMap((group) =>
              group.widgets.map((widget) => (
                <div key={widget.widgetId} className="w-[64px] shrink-0">
                  <WidgetTile widget={widget} onAdd={addWidget} />
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
                <div id={contentId} hidden={!open} className={cn("grid-cols-2 gap-2 pt-1", open && "grid")}>
                  {group.widgets.map((widget) => (
                    <WidgetPreviewTile key={widget.widgetId} widget={widget} onAdd={addWidget} />
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

const PREVIEW_STYLE: Record<WidgetPreviewKind, string> = {
  glyph: "font-serif text-2xl leading-none text-foreground/85",
  data: "font-mono text-xs tabular-nums leading-none text-foreground/85",
  wordmark: "break-words text-[10px] font-bold uppercase leading-tight tracking-widest text-foreground/70",
  swatch: "",
};

/** One tile in the library: a sample of what it puts on screen, then its full name. */
function WidgetPreviewTile<T extends PaletteWidget>({ widget, onAdd }: { widget: T; onAdd: (widget: T) => void }) {
  const preview = widgetPreviewFor(widget);
  return (
    <button
      type="button"
      onClick={() => onAdd(widget)}
      title={widget.description ?? widget.name}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left",
        "hover:border-foreground/30 hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
      data-testid={`add-widget-${widget.widgetId}`}
    >
      <span
        aria-hidden="true"
        className="relative flex h-14 w-full items-center justify-center overflow-hidden bg-muted/50 px-1.5"
      >
        {preview.kind === "swatch" ? (
          <span className="h-8 w-11 rounded-[3px] border border-foreground/10 bg-gradient-to-br from-primary/50 via-primary/20 to-muted-foreground/20" />
        ) : (
          <span className={cn("max-w-full text-center", PREVIEW_STYLE[preview.kind])}>{preview.sample}</span>
        )}
        {preview.live && (
          <span className="absolute right-1 top-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            live
          </span>
        )}
      </span>
      <span className="min-h-[2.25rem] w-full break-words px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-foreground">
        {widget.name}
      </span>
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
