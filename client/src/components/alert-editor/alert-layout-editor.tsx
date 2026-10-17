import type { ConfigField } from "@woofx3/api/ui-schema";
import { type CanvasSize, type CommandResult, canvasOf, type NodeView } from "@woofx3/scene/editor";
import { BookmarkPlus, ChevronDown, Loader2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  AddLibraryAlertDialog,
  type LibraryAlert,
  LibraryAlertList,
} from "@/components/alert-editor/alert-library-panel";
import { AlertStage } from "@/components/alert-editor/alert-stage";
import { PreviewScrub, PreviewTransport } from "@/components/alert-editor/composition-preview-frame";
import { LayerInspector } from "@/components/alert-editor/layer-inspector";
import { SaveToLibraryDialog } from "@/components/alert-editor/save-to-library-dialog";
import type { StageZoom } from "@/components/common/stage-area";
import { EditorBackLink } from "@/components/layout/editor-back-link";
import { LayersList } from "@/components/overlay-editor/layers-list";
import { OverlayEditorShell } from "@/components/overlay-editor/overlay-editor-shell";
import { WidgetPalette } from "@/components/overlay-editor/widget-palette";
import { StatusIndicator } from "@/components/scenes/draft-live-controls";
import { WidgetBehaviorsSection } from "@/components/scenes/widget-behaviors-section";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAlertLibrary } from "@/engine/hooks/use-alert-library";
import { type AlertEditorHandle, useAlertLayoutEditor } from "@/hooks/use-alert-layout-editor";
import { useCollapsedSidebar } from "@/hooks/use-collapsed-sidebar";
import { useCompositionPreview } from "@/hooks/use-composition-preview";
import { useInstance } from "@/hooks/use-instance";
import { useToast } from "@/hooks/use-toast";
import { durationOf, formatSeconds, layerLabel, playedLengthSeconds } from "@/lib/alert-editor";
import { libraryAlertEditorPath } from "@/lib/alert-editor-route";
import { inlineCopyOfLibraryAlert, unfilledInputsText, withLayersOf } from "@/lib/alert-library";
import {
  activityEditFor,
  activityOf,
  hasActivities,
  type LayerWindow,
  layerWindowOf,
  trackWindowLabel,
} from "@/lib/behavior-editor";
import { previewDocumentOf, sampleEventOf } from "@/lib/composition-preview";
import { canvasBackgroundOf, catalogWidgetOf } from "@/lib/scene-composition";
import { toDisplayText, variableNames } from "@/lib/variable-display";
import type { VariableOption } from "@/lib/workflow-variables";

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
  /**
   * On an engine with an alert library, offer the Library tab (copy a library alert's
   * layers onto the canvas) and Save to library (store a copy of this alert there).
   */
  offerLibrary?: boolean;
}

/**
 * The editor for one alert's content: a canvas of layers, the widgets that can be added
 * to it, and the settings of whichever layer is selected.
 *
 * It is a view over a composition editor (`@woofx3/scene/editor`, alert profile) holding
 * a copy of the layout, so nothing the caller holds changes until Done. Both surfaces
 * that own an alert step — a trigger on the Alerts screen and a chat command — give it
 * its own route and hand the result back to their own draft, where it waits for that
 * screen's Save with every other unsaved edit.
 */
export function AlertLayoutEditor({
  value,
  context,
  backLabel,
  availableVariables,
  onDone,
  onCancel,
  offerLibrary = false,
}: AlertLayoutEditorProps) {
  const session = useAlertLayoutEditor(value);
  // Where to go once the edits are confirmed discarded: back out, or to a library alert.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [, navigate] = useLocation();
  const [addingFromLibrary, setAddingFromLibrary] = useState<LibraryAlert | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  useCollapsedSidebar();
  const view = useAlertEditorView(session, availableVariables);
  const libraryAlerts = useAlertLibrary();
  const { toast } = useToast();

  if (session === null || view === null) {
    return <EditorLoading />;
  }

  const libraryOffered = offerLibrary && libraryAlerts.enabled;
  const leaveTo = (go: () => void) => {
    if (session.isDirty) {
      setPendingLeave(() => go);
      return;
    }
    go();
  };
  const leave = () => leaveTo(onCancel);
  const editLibraryAlert = (alert: LibraryAlert) => {
    leaveTo(() => navigate(libraryAlertEditorPath(alert.engineCompositionId)));
  };
  const done = () => onDone(session.changedLayout());
  const addFromLibrary = (alert: LibraryAlert) => {
    setAddingFromLibrary(null);
    const current = session.state.doc;
    if (current === null) {
      return;
    }
    const { doc: copy, unfilled } = inlineCopyOfLibraryAlert(alert, availableVariables);
    session.replace(withLayersOf(current, copy));
    session.editor.dispatch("selection.clear");
    if (unfilled.length > 0) {
      toast({ title: "Some of its inputs had no value", description: unfilledInputsText(unfilled) });
    }
  };
  const library = libraryOffered
    ? (layout: "grid" | "row") => (
        <LibraryAlertList
          alerts={libraryAlerts.alerts}
          layout={layout}
          onPick={setAddingFromLibrary}
          onEdit={editLibraryAlert}
        />
      )
    : undefined;

  return (
    <>
      <AlertEditorFrame
        session={session}
        view={view}
        title="Edit alert"
        context={context}
        backLabel={backLabel}
        onBack={leave}
        library={library}
        actions={
          <>
            <StatusIndicator ok={!session.isDirty} testId="status-saved">
              {session.isDirty ? "Unsaved changes" : "All changes saved"}
            </StatusIndicator>
            <Button variant="ghost" onClick={leave}>
              Cancel
            </Button>
            <div className="flex items-center">
              <Button
                onClick={done}
                className={libraryOffered ? "rounded-r-none" : undefined}
                data-testid="button-alert-done"
              >
                Done
              </Button>
              {libraryOffered && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      className="rounded-l-none border-l border-primary-foreground/25"
                      aria-label="More options"
                      data-testid="button-alert-done-menu"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSavingToLibrary(true)} data-testid="button-save-to-library">
                      <BookmarkPlus className="h-4 w-4 mr-2" />
                      Save to Library
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        }
        phoneAction={
          <Button className="h-11" onClick={done} data-testid="button-alert-done">
            Done
          </Button>
        }
        phoneExtras={
          libraryOffered ? (
            <Button variant="outline" className="h-11" onClick={() => setSavingToLibrary(true)}>
              Save to Library
            </Button>
          ) : null
        }
      />

      {libraryOffered && (
        <>
          <AddLibraryAlertDialog
            alert={addingFromLibrary}
            onClose={() => setAddingFromLibrary(null)}
            onConfirm={addFromLibrary}
          />
          <SaveToLibraryDialog
            open={savingToLibrary}
            onOpenChange={setSavingToLibrary}
            doc={session.state.doc}
            availableVariables={availableVariables}
            takenNames={libraryAlerts.alerts?.map((alert) => alert.name)}
            onSaved={() => setSavingToLibrary(false)}
          />
        </>
      )}

      <DiscardAlertChangesDialog
        open={pendingLeave !== null}
        onOpenChange={(open) => (open ? undefined : setPendingLeave(null))}
        onDiscard={() => pendingLeave?.()}
      />
    </>
  );
}

function EditorLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

interface AlertEditorFrameProps {
  session: AlertEditorHandle;
  view: AlertEditorView;
  title: ReactNode;
  context: ReactNode;
  backLabel: string;
  onBack: () => void;
  /** The desktop header's controls. */
  actions: ReactNode;
  /** Shown beside the desktop header's title, where its changing length never moves the controls. */
  status?: ReactNode;
  /** The phone header's one button. */
  phoneAction: ReactNode;
  /** Anything the phone layout shows above the palette. */
  phoneExtras?: ReactNode;
  /** Shown under the desktop header's controls on a phone, beside the canvas readout. */
  phoneStatus?: ReactNode;
  /** The alert library, listed in the palette's Library tab; omitted, the palette has only widgets. */
  library?: (layout: "grid" | "row") => ReactNode;
}

/**
 * The alert editor's page: a header over the stage, palette, layers and inspector on a
 * desktop, and a stacked column on a phone. Shared by an alert written into a step and
 * one edited in the library, which differ only in the header's controls.
 */
export function AlertEditorFrame({
  session,
  view,
  title,
  context,
  backLabel,
  onBack,
  actions,
  status,
  phoneAction,
  phoneExtras,
  phoneStatus,
  library,
}: AlertEditorFrameProps) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // The phone stage sets its own zoom; back on a desktop width the stage fits again.
  const editor = session.editor;
  useEffect(() => {
    if (isDesktop) {
      editor.dispatch("view.zoomFit");
    }
  }, [isDesktop, editor]);

  const readout = `${view.canvas.width} × ${view.canvas.height}`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {isDesktop ? (
        <>
          <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-3">
              <EditorBackLink label={backLabel} onClick={onBack} />
              <div className="min-w-0">
                <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
                <p className="truncate text-[13px] text-muted-foreground">{context}</p>
              </div>
              {status}
            </div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </header>
          <AlertEditorShell view={view} library={library} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="sticky top-0 z-20 border-b bg-background">
            <header className="flex items-center gap-2 px-2 py-2">
              <EditorBackLink label={backLabel} onClick={onBack} />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
                <p className="truncate text-[13px] text-muted-foreground">{context}</p>
              </div>
              {phoneAction}
            </header>
            <PhoneStageArea canvas={view.canvas} onZoom={(zoom) => session.editor.viewport.setZoom(zoom)}>
              {view.stage}
            </PhoneStageArea>
            {view.scrub !== null && <div className="px-4 pb-1">{view.scrub}</div>}
            <div className="flex items-center justify-between px-4 pb-2 font-mono text-xs text-muted-foreground">
              <span>{phoneStatus ?? `${readout} · drag to move`}</span>
              {view.transport === null ? <span>{view.lengthLabel}</span> : view.transport(false)}
            </div>
          </div>
          <div className="flex flex-col gap-6 px-4 py-5">
            {phoneExtras}
            {view.palette("row")}
            {library && (
              <section className="flex min-w-0 flex-col gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  From library
                </h2>
                {library("row")}
              </section>
            )}
            {view.layerList(true)}
            {view.inspector ? (
              <div className="rounded-2xl border bg-card p-4">{view.inspector}</div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Tap a layer on the canvas to edit it, or add a widget above.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Asks before edits to an alert are thrown away. */
export function DiscardAlertChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes to this alert?</AlertDialogTitle>
          <AlertDialogDescription>
            The alert goes back to how it was when you opened it. Done keeps your changes instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Discard changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The parts of the alert editor every layout arranges: palette, layers, stage and inspector. */
export interface AlertEditorView {
  canvas: CanvasSize;
  lengthLabel: string;
  layerCount: number;
  zoomControl: StageZoom;
  palette: (layout: "grid" | "row") => ReactNode;
  layerList: (horizontal?: boolean) => ReactNode;
  stage: (zoom: number) => ReactNode;
  /** The selected layer's settings, or null when nothing is selected. */
  inspector: ReactNode | null;
  /**
   * Play, restart and the playhead of the engine's live preview, in place of the
   * length readout, with the scrub when `scrub`; null while the stand-ins draw.
   */
  transport: ((scrub: boolean) => ReactNode) | null;
  /** The scrub alone, for a layout that puts it under the stage; null with no transport. */
  scrub: ReactNode | null;
  /** Clears the selection, as a press outside the canvas does. */
  deselect: () => void;
}

/** A layer as the layers list shows it. */
interface NodeLayer {
  id: string;
  visible: boolean;
  node: NodeView;
}

/**
 * The alert editor's parts, drawn from the composition editor's state. Every change
 * goes to the editor, which refuses what it cannot do with a reason shown as a toast.
 */
export function useAlertEditorView(
  session: AlertEditorHandle | null,
  availableVariables: VariableOption[],
  /** A library alert's values for its own inputs, which the live preview binds. */
  previewInputs?: Record<string, unknown>
): AlertEditorView | null {
  const { toast } = useToast();
  // Keyed by content: a caller may hand the same variables in a new array on every render, and new
  // names would reload the live preview.
  const variablesKey = JSON.stringify(availableVariables.map((variable) => variable.value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: variablesKey stands for availableVariables' content
  const names = useMemo(() => variableNames(availableVariables), [variablesKey]);
  const displayText = useCallback((text: string) => toDisplayText(text, names), [names]);
  const report = useCallback(
    (result: CommandResult) => {
      if (!result.ok) {
        toast({ title: "This change couldn't be made", description: result.detail, variant: "destructive" });
      }
    },
    [toast]
  );

  const editor = session?.editor ?? null;
  const state = session?.state ?? null;

  const { instance } = useInstance();
  const committed = state?.doc ?? null;
  const previewDocument = useMemo(
    () => (committed === null ? null : previewDocumentOf(committed, names)),
    [committed, names]
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: names changes exactly when the variables' content does
  const sampleEvent = useMemo(() => sampleEventOf(availableVariables, names), [names]);
  // Keyed by content, as the variables are.
  const inputsKey = previewInputs === undefined ? null : JSON.stringify(previewInputs);
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputsKey stands for previewInputs' content
  const boundInputs = useMemo(() => previewInputs, [inputsKey]);
  const preview = useCompositionPreview({
    instanceId: instance?._id,
    editor,
    state,
    document: previewDocument,
    event: sampleEvent,
    inputs: boundInputs,
    labelOf: (id) => {
      const doc = state?.doc;
      const target = doc?.behaviors[id]?.target ?? id;
      const node = state?.view.nodes.find((candidate) => candidate.id === target);
      return node === undefined
        ? undefined
        : layerLabel({ kind: node.kind, name: node.placement.name, settings: node.placement.settings }, displayText);
    },
  });

  const zoom = state?.viewport.zoom ?? 1;
  const fit = state?.viewport.fit ?? true;
  const zoomControl: StageZoom | null = useMemo(
    () =>
      editor === null
        ? null
        : {
            zoom,
            fit,
            onMeasure: (size) => editor.viewport.setStage(size),
            zoomIn: () => editor.dispatch("view.zoomIn"),
            zoomOut: () => editor.dispatch("view.zoomOut"),
            zoomToFit: () => editor.dispatch("view.zoomFit"),
          },
    [editor, zoom, fit]
  );

  if (session === null || state === null || state.doc === null || zoomControl === null) {
    return null;
  }

  const { catalogRows } = session;
  const canvas = canvasOf(state.doc);
  const nodes = state.view.nodes;
  const rowFor = (widgetId: string) => catalogRows.find((row) => row.widgetId === widgetId);
  const labelOf = (node: NodeView) =>
    layerLabel({ kind: node.kind, name: node.placement.name, settings: node.placement.settings }, displayText);
  const doc = state.doc;
  // Once a layer has a window of its own, its duration alone no longer says when it plays: the
  // editor's resolved tracks do.
  const tracks = hasActivities(doc.behaviors) ? state.timeline.tracks : null;
  const timed = nodes.map((node) => ({ id: node.id, settings: node.placement.settings }));
  const length = playedLengthSeconds(state.timeline.tracks, timed);
  const lengthLabel = length > 0 ? `Plays ${formatSeconds(length)}` : "Plays instantly";
  const placeable = new Set(state.palette.map((row) => row.widgetId));
  const paletteRows = catalogRows.filter((row) => placeable.has(row.widgetId));
  const layers: NodeLayer[] = [...nodes]
    .reverse()
    .map((node) => ({ id: node.id, visible: node.placement.visible, node }));

  const selected = nodes.find((node) => node.id === state.selection.primary) ?? null;
  const changeWindow = (id: string, window: LayerWindow) => {
    const edit = activityEditFor(activityOf(doc.behaviors, id), window);
    switch (edit.op) {
      case "none":
        return;
      case "add":
        report(session.editor.behaviors.add(id, "activity", "window", edit.timing));
        return;
      case "patch":
        report(session.editor.behaviors.patch(edit.id, { timing: edit.timing }));
        return;
      case "remove":
        report(session.editor.behaviors.remove(edit.id));
        return;
    }
  };
  const selectedRow = selected ? rowFor(selected.placement.widget) : undefined;
  const inspector = selected ? (
    <LayerInspector
      key={selected.id}
      node={selected}
      fields={(selectedRow?.settings ?? []) as unknown as ConfigField[]}
      availableVariables={availableVariables}
      onChangeSettings={(settings) => report(session.editor.nodes.patch(selected.id, { settings }))}
      window={layerWindowOf(activityOf(doc.behaviors, selected.id)?.behavior ?? null)}
      onChangeWindow={(window) => changeWindow(selected.id, window)}
    >
      <WidgetBehaviorsSection
        editor={session.editor}
        behaviors={doc.behaviors}
        nodeId={selected.id}
        row={selectedRow === undefined ? undefined : catalogWidgetOf(selectedRow)}
        anchors={state.capabilities.anchors}
        disabled={state.capabilities.readOnly}
        onRefused={report}
      />
    </LayerInspector>
  ) : null;

  return {
    canvas,
    lengthLabel,
    layerCount: nodes.length,
    zoomControl,
    palette: (layout) => (
      <WidgetPalette
        widgets={paletteRows}
        onAdd={(row) => report(session.editor.nodes.add(row.widgetId))}
        layout={layout}
        emptyMessage="No alert widgets are installed."
      />
    ),
    layerList: (horizontal = false) => (
      <LayersList
        layers={layers}
        selectedId={state.selection.primary}
        label={(layer) => labelOf(layer.node)}
        taxonomyOf={(layer) => rowFor(layer.node.placement.widget)?.taxonomy}
        meta={(layer) => {
          const window = tracks === null ? null : trackWindowLabel(tracks, layer.id);
          if (window !== null) {
            return window;
          }
          const duration = durationOf(layer.node.placement);
          return duration > 0 ? formatSeconds(duration) : "auto";
        }}
        onSelect={(id) => session.editor.dispatch("selection.select", { id })}
        onMove={(id, toIndex) => report(session.editor.nodes.reorder(id, { index: nodes.length - 1 - toIndex }))}
        onDelete={(id) => report(session.editor.nodes.remove([id]))}
        horizontal={horizontal}
        emptyMessage="No layers yet. Add a widget to start."
      />
    ),
    stage: (stageZoom) => (
      <AlertStage
        editor={session.editor}
        canvas={canvas}
        background={canvasBackgroundOf(doc.layout)}
        nodes={nodes}
        guides={state.guides}
        zoom={stageZoom}
        layerLabel={labelOf}
        displayText={displayText}
        onRefused={report}
        preview={preview}
      />
    ),
    inspector,
    transport: preview.live
      ? (scrub) => (
          <PreviewTransport
            preview={preview}
            playheadMs={state.timeline.playheadMs}
            playing={state.timeline.playing}
            scrub={scrub}
          />
        )
      : null,
    scrub: preview.live ? <PreviewScrub preview={preview} playheadMs={state.timeline.playheadMs} /> : null,
    deselect: () => session.editor.dispatch("selection.clear"),
  };
}

/**
 * The desktop arrangement: palette, stage and layers with the inspector, in the shared
 * overlay editor frame. The stage's bottom bar carries the canvas readout and the
 * timeline; with a library, the palette rail has a Library tab beside its widgets.
 */
export function AlertEditorShell({
  view,
  library,
  className,
}: {
  view: AlertEditorView;
  library?: (layout: "grid" | "row") => ReactNode;
  className?: string;
}) {
  const readout = `${view.canvas.width} × ${view.canvas.height}`;
  const palette = view.palette("grid");
  return (
    <OverlayEditorShell
      canvas={view.canvas}
      className={className}
      zoomControl={view.zoomControl}
      stageToolbar={
        <>
          <span className="shrink-0">{readout}</span>
          <span className="shrink-0 text-border">|</span>
          {view.transport === null ? <span className="truncate">{view.lengthLabel}</span> : view.transport(true)}
        </>
      }
      onDeselect={view.deselect}
      palette={
        library === undefined ? (
          palette
        ) : (
          <Tabs defaultValue="widgets" className="flex min-w-0 flex-col gap-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="widgets" data-testid="tab-palette-widgets">
                Widgets
              </TabsTrigger>
              <TabsTrigger value="library" data-testid="tab-palette-library">
                Library
              </TabsTrigger>
            </TabsList>
            <TabsContent value="widgets" className="mt-0">
              {palette}
            </TabsContent>
            <TabsContent value="library" className="mt-0">
              {library("grid")}
            </TabsContent>
          </Tabs>
        )
      }
      layers={view.layerList()}
      stage={view.stage}
      inspector={view.inspector ? <div className="p-4">{view.inspector}</div> : null}
      inspectorFallback={<AlertSummary view={view} />}
    />
  );
}

/**
 * The phone stage: the canvas across the full width, at whatever zoom that takes. The
 * zoom is handed to the editor too, which reads pointer positions through it.
 */
function PhoneStageArea({
  canvas,
  onZoom,
  children,
}: {
  canvas: CanvasSize;
  onZoom: (zoom: number) => void;
  children: (zoom: number) => ReactNode;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.18);
  // The observer outlives renders, so it reaches the current callback through a ref.
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width / canvas.width;
      if (next > 0) {
        setZoom(next);
        onZoomRef.current(next);
      }
    });
    observer.observe(area);
    return () => observer.disconnect();
  }, [canvas.width]);

  return (
    <div ref={areaRef} className="mx-4 mb-2 overflow-hidden rounded-lg">
      {children(zoom)}
    </div>
  );
}

/** What the inspector shows with no layer selected. */
function AlertSummary({ view }: { view: AlertEditorView }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">Alert</h2>
      <p className="text-xs text-muted-foreground">
        Select a layer to edit it, or add a widget from the left. The alert is scaled to fit whichever alert widget
        plays it.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Canvas</dt>
        <dd className="font-mono text-xs leading-5">
          {view.canvas.width} × {view.canvas.height}
        </dd>
        <dt className="text-muted-foreground">Length</dt>
        <dd className="text-xs leading-5">{view.lengthLabel}, exits included</dd>
        <dt className="text-muted-foreground">Layers</dt>
        <dd className="font-mono text-xs leading-5">{view.layerCount}</dd>
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
