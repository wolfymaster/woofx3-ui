import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { useQuery } from "convex/react";
import { ArrowLeft, Bell, Film, Image, Loader2, Minus, Plus, Sparkles, Square, Type, Volume2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertStage } from "@/components/alert-editor/alert-stage";
import { LayerInspector } from "@/components/alert-editor/layer-inspector";
import { EmptyState } from "@/components/common/empty-state";
import type { LoadedFieldOptions } from "@/components/triggers/condition-sentence";
import { FieldOptionsLoader } from "@/components/triggers/field-options-loader";
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
import { useEventWorkflowDraft } from "@/hooks/use-event-workflow-draft";
import { useInstance } from "@/hooks/use-instance";
import { useWorkflowCatalog } from "@/hooks/use-workflow-catalog";
import {
  alertLengthSeconds,
  type CatalogWidget,
  centerOf,
  clampCenter,
  durationOf,
  fitZoom,
  type LayerKind,
  layerKind,
  longestLayerId,
  newLayer,
  withCenter,
  zoomIn,
  zoomOut,
} from "@/lib/alert-editor";
import { alertMenuPath } from "@/lib/alert-groups";
import { type AlertLayout, readAlertLayout, writeAlertLayout } from "@/lib/alert-layout";
import { sentenceParts } from "@/lib/condition-sentence";
import { updateDraftValue } from "@/lib/event-drafts";
import { isCommandsSource, isInternalSource } from "@/lib/parse-config-fields";
import { cn } from "@/lib/utils";
import { toDisplayText, variableNames } from "@/lib/variable-display";
import { placeableOn } from "@/lib/widget-surfaces";
import type { ActionPreset } from "@/lib/workflow-presets";
import { projectedActionVariables } from "@/lib/workflow-variables";
import type { Widget } from "@/types";

/** Room around the canvas when it is fitted to the stage area, clear of the zoom control. */
const FIT_PADDING = 32;
const ZOOM_CONTROL_ROOM = 56;
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

/**
 * The editor for one Alert step's content, on its own route.
 *
 * It edits a copy of the step's layout. Done hands the copy back to the event's draft
 * (lib/event-drafts.ts) and returns to the triggers page, where it waits with the
 * page's other unsaved edits for Save; Cancel and Back drop it, asking first when it
 * has changed.
 */
export default function AlertEditorPage() {
  const params = useParams<{ event: string; triggerId: string; actionId: string }>();
  const event = decodeParam(params.event);
  const triggerId = decodeParam(params.triggerId);
  const actionId = decodeParam(params.actionId);
  const [, navigate] = useLocation();
  const { instance } = useInstance();
  const { triggerPresets, actionPresets, loading: catalogLoading } = useWorkflowCatalog();
  const workflows = useQuery(api.workflows.list, instance ? { instanceId: instance._id as Id<"instances"> } : "skip");
  const widgetRows = useQuery(api.sceneWidgets.listForInstance, instance ? { instanceId: instance._id } : "skip");

  const triggerPreset = triggerPresets.find((preset) => preset.event === event);
  const conditionFields = useMemo(
    () => (triggerPreset?.config?.fields ?? []).filter((field) => !isCommandsSource(field)),
    [triggerPreset]
  );
  const { draft } = useEventWorkflowDraft(triggerPreset, conditionFields, workflows as Doc<"workflows">[] | undefined);

  const catalog = useMemo(() => placeableOn(widgetRows ?? [], "alert"), [widgetRows]);
  const nameOf = useCallback(
    (widgetCanonicalId: string) => catalog.find((row) => row.widgetId === widgetCanonicalId)?.name ?? widgetCanonicalId,
    [catalog]
  );

  const trigger = draft?.value.triggers.find((candidate) => candidate.id === triggerId);
  const actionIndex = trigger?.actions.findIndex((candidate) => candidate.id === actionId) ?? -1;
  const action = trigger && actionIndex >= 0 ? trigger.actions[actionIndex] : undefined;

  const resolveActionPreset = useCallback(
    (candidate: { functionCall?: string; handlerType: string }): ActionPreset | undefined =>
      actionPresets.find((preset) =>
        candidate.functionCall
          ? preset.functionCall === candidate.functionCall
          : preset.handlerType === candidate.handlerType
      ),
    [actionPresets]
  );
  const availableVariables = useMemo(
    () =>
      triggerPreset && trigger && actionIndex >= 0
        ? projectedActionVariables(triggerPreset, trigger.actions, actionIndex, resolveActionPreset)
        : [],
    [triggerPreset, trigger, actionIndex, resolveActionPreset]
  );
  const names = useMemo(() => variableNames(availableVariables), [availableVariables]);
  const displayText = useCallback((text: string) => toDisplayText(text, names), [names]);

  // The layout being edited, and what it was when the editor opened. Seeded once from
  // the draft: later changes to the draft must not overwrite edits made here.
  const [layout, setLayout] = useState<AlertLayout | null>(null);
  const [openedAs, setOpenedAs] = useState<string | null>(null);
  useEffect(() => {
    if (layout === null && action && widgetRows !== undefined) {
      const opened = readAlertLayout(action.parameters.layout, nameOf);
      setLayout(opened);
      setOpenedAs(JSON.stringify(writeAlertLayout(opened)));
    }
  }, [layout, action, widgetRows, nameOf]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [loadedOptions, setLoadedOptions] = useState<ReadonlyMap<string, LoadedFieldOptions>>(new Map());
  const handleOptionsLoaded = useCallback((fieldId: string, entry: LoadedFieldOptions) => {
    setLoadedOptions((previous) => new Map(previous).set(fieldId, entry));
  }, []);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isDirty = layout !== null && openedAs !== null && JSON.stringify(writeAlertLayout(layout)) !== openedAs;
  const menuPath = triggerPreset ? alertMenuPath(triggerPreset) : undefined;
  const backHref = menuPath ? `/stream/alerts/${menuPath.map(encodeURIComponent).join("/")}` : "/stream/alerts";

  const leave = () => {
    if (isDirty) {
      setConfirmingLeave(true);
      return;
    }
    navigate(backHref);
  };

  const done = () => {
    if (layout && isDirty) {
      const stored = writeAlertLayout(layout);
      updateDraftValue(event, (current) => ({
        ...current,
        triggers: current.triggers.map((t) =>
          t.id === triggerId
            ? {
                ...t,
                actions: t.actions.map((a) =>
                  a.id === actionId ? { ...a, parameters: { ...a.parameters, layout: stored as never } } : a
                ),
              }
            : t
        ),
      }));
    }
    navigate(backHref);
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

  if (catalogLoading || workflows === undefined || widgetRows === undefined || (action && !layout)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!triggerPreset || !trigger || !action || !layout) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Bell}
          title="This alert isn't here any more"
          description="The trigger or step it belonged to was removed, or the link is from another instance."
          action={{ label: "Back to alerts", onClick: () => navigate(backHref) }}
        />
      </div>
    );
  }

  const parts = sentenceParts(
    triggerPreset.sentence,
    conditionFields,
    draft?.value.conditionValues[trigger.id] ?? {},
    new Map(
      Array.from(loadedOptions.entries()).map(([fieldId, entry]) => [
        fieldId,
        new Map(entry.options.map((option) => [option.value, option.label])),
      ])
    )
  );
  const length = alertLengthSeconds(layout.widgets);
  const longestId = layout.widgets.length > 1 ? longestLayerId(layout.widgets) : undefined;
  const selected = layout.widgets.find((widget) => widget.id === selectedId) ?? null;
  const selectedFields = (selected
    ? (catalog.find((row) => row.widgetId === selected.widgetCanonicalId)?.settings ?? [])
    : []) as unknown as ConfigField[];
  const layersNewestFirst = [...layout.widgets].sort((a, b) => b.zIndex - a.zIndex);
  const readout = `${layout.width} × ${layout.height}`;
  const lengthLabel = length > 0 ? `Plays ${formatSeconds(length)}` : "Plays instantly";

  const context = (
    <>
      {triggerPreset.name} ·{" "}
      {parts.map((part, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: sentence parts are positional and never reorder
          key={index}
          className={part.kind === "field" ? "font-medium text-foreground" : undefined}
        >
          {part.text}
        </span>
      ))}{" "}
      · Step {actionIndex + 1}
    </>
  );

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
      {conditionFields.filter(isInternalSource).map((field) => (
        <FieldOptionsLoader key={field.id} field={field} onLoaded={handleOptionsLoaded} />
      ))}

      {isDesktop ? (
        <>
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-3">
              <BackLink label={triggerPreset.name} onClick={leave} />
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
            <DesktopStageArea canvas={layout}>{stage}</DesktopStageArea>
            <aside className="min-h-0 overflow-y-auto border-l p-4">
              {inspector ?? <AlertSummary layout={layout} lengthLabel={lengthLabel} />}
            </aside>
          </div>
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-20 border-b bg-background">
            <header className="flex items-center gap-2 px-2 py-2">
              <BackLink label={triggerPreset.name} onClick={leave} />
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
            <AlertDialogAction onClick={() => navigate(backHref)}>Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 shrink-0 lg:h-10 lg:w-10"
      onClick={onClick}
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
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

/** The desktop stage: the canvas fitted to the space between the rails, with zoom controls. */
function DesktopStageArea({ canvas, children }: { canvas: AlertLayout; children: (zoom: number) => React.ReactNode }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.36);
  // Null follows Fit as the window resizes; a number is a zoom the user picked.
  const [chosenZoom, setChosenZoom] = useState<number | null>(null);
  const zoom = chosenZoom ?? fit;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setFit(fitZoom({ width, height: height - ZOOM_CONTROL_ROOM }, canvas, FIT_PADDING));
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [canvas]);

  return (
    <div
      ref={areaRef}
      className="relative min-h-0 overflow-auto"
      style={{
        backgroundImage: "radial-gradient(hsl(var(--border)) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <div
        className="flex min-h-full min-w-full items-center justify-center p-8 pb-20"
        style={{ width: "max-content" }}
      >
        {children(zoom)}
      </div>
      <div className="sticky bottom-4 left-0 flex justify-center">
        <div className="flex items-center gap-1 rounded-xl border bg-popover p-1 shadow-lg">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setChosenZoom(zoomOut(zoom))}
            aria-label="Zoom out"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center font-mono text-xs">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setChosenZoom(zoomIn(zoom))}
            aria-label="Zoom in"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs"
            onClick={() => setChosenZoom(null)}
            aria-pressed={chosenZoom === null}
          >
            Fit
          </Button>
        </div>
      </div>
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

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
