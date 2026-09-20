import { api } from "@convex/_generated/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertStage } from "@/components/alert-editor/alert-stage";
import { LayerInspector } from "@/components/alert-editor/layer-inspector";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import { LayersList } from "@/components/overlay-editor/layers-list";
import { OverlayEditorShell } from "@/components/overlay-editor/overlay-editor-shell";
import { WidgetPalette } from "@/components/overlay-editor/widget-palette";
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
  layerKind,
  longestLayerId,
  newLayer,
  withCenter,
} from "@/lib/alert-editor";
import { type AlertLayout, readAlertLayout, writeAlertLayout } from "@/lib/alert-layout";
import { toDisplayText, variableNames } from "@/lib/variable-display";
import { placeableOn } from "@/lib/widget-surfaces";
import type { VariableOption } from "@/lib/workflow-variables";
import type { Widget } from "@/types";

/** Width the phone layout switches at; below it the stage is a fixed-width strip. */
const DESKTOP_QUERY = "(min-width: 1024px)";

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

  const taxonomyOf = (widget: Widget) => catalog.find((row) => row.widgetId === widget.widgetCanonicalId)?.taxonomy;

  const palette = (layout: "grid" | "row") => (
    <WidgetPalette widgets={catalog} onAdd={addLayer} layout={layout} emptyMessage="No alert widgets are installed." />
  );

  const layerList = (horizontal = false) => (
    <LayersList
      layers={layersNewestFirst}
      selectedId={selectedId}
      label={layerLabel}
      taxonomyOf={taxonomyOf}
      meta={(widget) => {
        const duration = durationOf(widget);
        return duration > 0 ? formatSeconds(duration) : "auto";
      }}
      onSelect={setSelectedId}
      horizontal={horizontal}
      emptyMessage="No layers yet. Add a widget to start."
    />
  );

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
          <OverlayEditorShell
            canvas={layout}
            palette={palette("grid")}
            layers={layerList()}
            stage={stage}
            inspector={inspector ? <div className="p-4">{inspector}</div> : null}
            inspectorFallback={<AlertSummary layout={layout} lengthLabel={lengthLabel} />}
          />
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
            {palette("row")}
            {layerList(true)}
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
