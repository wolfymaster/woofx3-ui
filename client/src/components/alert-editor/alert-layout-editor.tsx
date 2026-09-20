import { api } from "@convex/_generated/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useQuery } from "convex/react";
import { Film, Image, Loader2, Sparkles, Square, Type, Volume2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertStage } from "@/components/alert-editor/alert-stage";
import { LayerInspector } from "@/components/alert-editor/layer-inspector";
import { StageArea } from "@/components/common/stage-area";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useInstance } from "@/hooks/use-instance";
import {
  alertLengthSeconds,
  type CatalogWidget,
  centerOf,
  clampCenter,
  durationOf,
  type LayerKind,
  layerKind,
  longestLayerId,
  newLayer,
  withCenter,
} from "@/lib/alert-editor";
import { type AlertLayout, readAlertLayout, writeAlertLayout } from "@/lib/alert-layout";
import { cn } from "@/lib/utils";
import { toDisplayText, variableNames } from "@/lib/variable-display";
import { placeableOn } from "@/lib/widget-surfaces";
import type { VariableOption } from "@/lib/workflow-variables";
import type { Widget } from "@/types";

/** Width the phone layout switches at; below it the stage is a fixed-width strip. */
const DESKTOP_QUERY = "(min-width: 1024px)";

const KIND_ICON: Record<LayerKind, typeof Square> = {
  text: Type,
  image: Image,
  video: Film,
  audio: Volume2,
  lottie: Sparkles,
  other: Square,
};

interface AlertLayoutEditorProps {
  /** The step's stored layout, read once when the editor opens. */
  value: unknown;
  /** What is being edited, shown under the title — the trigger and step, or the command and step. */
  context: ReactNode;
  /** Named in the back arrow's label: "Back to {backLabel}". */
  backLabel: string;
  /** Offered in the layers' text settings; whatever the step that owns this layout can reference. */
  availableVariables: VariableOption[];
  /**
   * Hands the edited layout back in stored form, or `null` when nothing changed. Either
   * way the caller then leaves — the editor does no navigating of its own.
   */
  onDone: (layout: unknown | null) => void;
  /** Leaving without keeping the edits; already confirmed when there were any. */
  onCancel: () => void;
}

/**
 * The editor for one alert's content: a canvas of layers, the widgets that can be added
 * to it, and the settings of whichever layer is selected.
 *
 * It edits a copy, so nothing the caller holds changes until Done. Both surfaces that own
 * an alert step — a trigger on the Alerts screen and a chat command — give it its own
 * route and hand the result back to their own draft, where it waits for that screen's
 * Save with every other unsaved edit.
 */
export function AlertLayoutEditor({
  value,
  context,
  backLabel,
  availableVariables,
  onDone,
  onCancel,
}: AlertLayoutEditorProps) {
  const { instance } = useInstance();
  const widgetRows = useQuery(api.sceneWidgets.listForInstance, instance ? { instanceId: instance._id } : "skip");

  const catalog = useMemo(() => placeableOn(widgetRows ?? [], "alert"), [widgetRows]);
  const nameOf = useCallback(
    (widgetCanonicalId: string) => catalog.find((row) => row.widgetId === widgetCanonicalId)?.name ?? widgetCanonicalId,
    [catalog]
  );

  const names = useMemo(() => variableNames(availableVariables), [availableVariables]);
  const displayText = useCallback((text: string) => toDisplayText(text, names), [names]);

  // The layout being edited, and what it was when the editor opened. Seeded once: a later
  // change to what the caller holds must not overwrite edits made here.
  const [layout, setLayout] = useState<AlertLayout | null>(null);
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  useEffect(() => {
    if (layout === null && widgetRows !== undefined) {
      const opened = readAlertLayout(value, nameOf);
      setLayout(opened);
      setOpenedAs(JSON.stringify(writeAlertLayout(opened)));
    }
  }, [layout, value, widgetRows, nameOf]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isDirty = layout !== null && openedAs !== null && JSON.stringify(writeAlertLayout(layout)) !== openedAs;

  const leave = () => {
    if (isDirty) {
      setConfirmingLeave(true);
      return;
    }
    onCancel();
  };

  const done = () => {
    onDone(layout && isDirty ? writeAlertLayout(layout) : null);
  };

  const editLayer = useCallback((widgetId: string, change: (widget: Widget) => Widget) => {
    setLayout((current) =>
      current
        ? { ...current, widgets: current.widgets.map((widget) => (widget.id === widgetId ? change(widget) : widget)) }
        : current
    );
  }, []);

  const deleteLayer = useCallback((widgetId: string) => {
    setLayout((current) =>
      current ? { ...current, widgets: current.widgets.filter((widget) => widget.id !== widgetId) } : current
    );
    setSelectedId((current) => (current === widgetId ? null : current));
  }, []);

  const addLayer = (row: CatalogWidget) => {
    if (!layout) {
      return;
    }
    const widget = newLayer(row, layout.widgets, layout);
    setLayout({ ...layout, widgets: [...layout.widgets, widget] });
    setSelectedId(widget.id);
  };

  // Arrow keys nudge the selected layer, Shift for ten pixels; Delete removes it. Bound
  // to the stage and its layers only, so typing in the inspector never moves anything.
  const handleStageKeyDown = (keyEvent: KeyboardEvent<HTMLElement>) => {
    if (!layout || !selectedId) {
      return;
    }
    const widget = layout.widgets.find((candidate) => candidate.id === selectedId);
    if (!widget) {
      return;
    }
    const step = keyEvent.shiftKey ? 10 : 1;
    const nudges: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const nudge = nudges[keyEvent.key];
    if (nudge) {
      keyEvent.preventDefault();
      const center = centerOf(widget);
      editLayer(widget.id, (w) =>
        withCenter(w, clampCenter({ x: center.x + nudge[0], y: center.y + nudge[1] }, layout))
      );
    } else if (keyEvent.key === "Delete" || keyEvent.key === "Backspace") {
      keyEvent.preventDefault();
      deleteLayer(widget.id);
    }
  };

  const layerLabel = useCallback(
    (widget: Widget) => {
      if (layerKind(widget) === "text") {
        const text = typeof widget.settings.text === "string" ? displayText(widget.settings.text).trim() : "";
        return text || widget.name;
      }
      const file = fileName(widget.settings.src);
      return file ? `${widget.name} · ${file}` : widget.name;
    },
    [displayText]
  );

  if (widgetRows === undefined || !layout) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const length = alertLengthSeconds(layout.widgets);
  const longestId = layout.widgets.length > 1 ? longestLayerId(layout.widgets) : undefined;
  const selected = layout.widgets.find((widget) => widget.id === selectedId) ?? null;
  const selectedFields = (selected
    ? (catalog.find((row) => row.widgetId === selected.widgetCanonicalId)?.settings ?? [])
    : []) as unknown as ConfigField[];
  const layersNewestFirst = [...layout.widgets].sort((a, b) => b.zIndex - a.zIndex);
  const readout = `${layout.width} × ${layout.height}`;
  const lengthLabel = length > 0 ? `Plays ${formatSeconds(length)}` : "Plays instantly";

  const inspector = selected ? (
    <LayerInspector
      key={selected.id}
      widget={selected}
      fields={selectedFields}
      canvas={layout}
      isLongest={selected.id === longestId}
      availableVariables={availableVariables}
      onChange={(next) => editLayer(selected.id, () => next)}
      onDelete={() => deleteLayer(selected.id)}
    />
  ) : null;

  const stage = (zoom: number) => (
    <AlertStage
      layout={layout}
      selectedId={selectedId}
      zoom={zoom}
      layerLabel={layerLabel}
      displayText={displayText}
      onSelect={setSelectedId}
      onMove={(widgetId, center) => editLayer(widgetId, (w) => withCenter(w, center))}
      onKeyDown={handleStageKeyDown}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {isDesktop ? (
        <>
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-3">
              <EditorBackLink label={backLabel} onClick={leave} />
              <div className="min-w-0">
                <h1 className="text-[17px] font-semibold leading-tight">Edit alert</h1>
                <p className="truncate text-[13px] text-muted-foreground">{context}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground">
                {readout} | {lengthLabel}
              </code>
              <Button variant="ghost" onClick={leave}>
                Cancel
              </Button>
              <Button onClick={done} data-testid="button-alert-done">
                Done
              </Button>
            </div>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)_296px]">
            <aside className="flex min-h-0 flex-col gap-6 overflow-y-auto border-r p-4">
              <WidgetTiles catalog={catalog} onAdd={addLayer} columns={2} />
              <LayersList
                layers={layersNewestFirst}
                selectedId={selectedId}
                layerLabel={layerLabel}
                onSelect={setSelectedId}
              />
            </aside>
            <StageArea canvas={layout}>{stage}</StageArea>
            <aside className="min-h-0 overflow-y-auto border-l p-4">
              {inspector ?? <AlertSummary layout={layout} lengthLabel={lengthLabel} />}
            </aside>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-20 border-b bg-background">
            <header className="flex items-center gap-2 px-2 py-2">
              <EditorBackLink label={backLabel} onClick={leave} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[17px] font-semibold leading-tight">Edit alert</h1>
                <p className="truncate text-[13px] text-muted-foreground">{context}</p>
              </div>
              <Button className="h-11" onClick={done} data-testid="button-alert-done">
                Done
              </Button>
            </header>
            <PhoneStageArea canvas={layout}>{stage}</PhoneStageArea>
            <div className="flex justify-between px-4 pb-2 font-mono text-xs text-muted-foreground">
              <span>{readout} · drag to move</span>
              <span>{lengthLabel}</span>
            </div>
          </div>
          <div className="flex flex-col gap-6 px-4 py-5">
            <WidgetTiles catalog={catalog} onAdd={addLayer} columns="row" />
            <LayersList
              layers={layersNewestFirst}
              selectedId={selectedId}
              layerLabel={layerLabel}
              onSelect={setSelectedId}
              horizontal
            />
            {inspector ? (
              <div className="rounded-2xl border bg-card p-4">{inspector}</div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tap a layer on the canvas to edit it, or add a widget above.
              </p>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes to this alert?</AlertDialogTitle>
            <AlertDialogDescription>
              The alert goes back to how it was when you opened it. Done keeps your changes instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={onCancel}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The widgets an alert can hold, as tiles that add a layer. */
function WidgetTiles({
  catalog,
  onAdd,
  columns,
}: {
  catalog: CatalogWidget[];
  onAdd: (row: CatalogWidget) => void;
  columns: 2 | "row";
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Add widget</h2>
      {catalog.length === 0 ? (
        <p className="text-xs text-muted-foreground">No alert widgets are installed.</p>
      ) : (
        <div className={cn("grid gap-2", columns === 2 ? "grid-cols-2" : "grid-flow-col auto-cols-[minmax(64px,1fr)]")}>
          {catalog.map((row) => {
            const Icon = KIND_ICON[layerKind({ widgetCanonicalId: row.widgetId })];
            return (
              <button
                key={row.widgetId}
                type="button"
                onClick={() => onAdd(row)}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 p-2 text-xs hover:border-foreground/20 hover:bg-accent"
                data-testid={`add-widget-${row.widgetId}`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary/15 text-primary-text">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="truncate">{row.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The layers, newest on top as they stack; picking one selects it on the stage. */
function LayersList({
  layers,
  selectedId,
  layerLabel,
  onSelect,
  horizontal = false,
}: {
  layers: Widget[];
  selectedId: string | null;
  layerLabel: (widget: Widget) => string;
  onSelect: (widgetId: string) => void;
  horizontal?: boolean;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Layers</h2>
      {layers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No layers yet. Add a widget to start.</p>
      ) : (
        <div className={cn(horizontal ? "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" : "flex flex-col gap-1")}>
          {layers.map((widget) => {
            const Icon = KIND_ICON[layerKind(widget)];
            const isSelected = widget.id === selectedId;
            const duration = durationOf(widget);
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
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{layerLabel(widget)}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {duration > 0 ? formatSeconds(duration) : "auto"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The phone stage: the canvas across the full width, at whatever zoom that takes. */
function PhoneStageArea({ canvas, children }: { canvas: AlertLayout; children: (zoom: number) => React.ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.18);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setZoom(entry.contentRect.width / canvas.width);
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [canvas]);

  return (
    <div ref={areaRef} className="mx-4 mb-2 overflow-hidden rounded-lg">
      {children(zoom)}
    </div>
  );
}

/** What the inspector shows with no layer selected. */
function AlertSummary({ layout, lengthLabel }: { layout: AlertLayout; lengthLabel: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">Alert</h2>
      <p className="text-xs text-muted-foreground">
        Select a layer to edit it, or add a widget from the left. The alert is scaled to fit whichever alert widget
        plays it.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Canvas</dt>
        <dd className="font-mono text-xs leading-5">
          {layout.width} × {layout.height}
        </dd>
        <dt className="text-muted-foreground">Length</dt>
        <dd className="text-xs leading-5">{lengthLabel} (longest layer)</dd>
        <dt className="text-muted-foreground">Layers</dt>
        <dd className="font-mono text-xs leading-5">{layout.widgets.length}</dd>
      </dl>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    onChange();
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function formatSeconds(seconds: number): string {
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

/** A media setting's file name: an uploaded asset carries one, a URL ends in one. */
function fileName(src: unknown): string {
  if (typeof src === "object" && src !== null && typeof (src as { name?: unknown }).name === "string") {
    return (src as { name: string }).name;
  }
  if (typeof src === "string" && src) {
    return src.split("/").pop() ?? src;
  }
  return "";
}
