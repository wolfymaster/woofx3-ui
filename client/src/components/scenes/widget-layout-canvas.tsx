import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  alertWidgetName,
  type CanvasSize,
  type CommandResult,
  type CompositionEditor,
  type EditorState,
  type Guide,
  type NodeView,
  type Point,
} from "@woofx3/scene/editor";
import { type ReactNode, useCallback, useMemo, useRef } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { CANVAS_STAGE_CLASS, type StageZoom } from "@/components/common/stage-area";
import { LayersList } from "@/components/overlay-editor/layers-list";
import { OverlayEditorShell } from "@/components/overlay-editor/overlay-editor-shell";
import { WidgetPalette } from "@/components/overlay-editor/widget-palette";
import type { SceneWidgetCatalogRow } from "@/engine/types";
import { canvasSettingsOf, catalogWidgetOf, type RemoteSelection } from "@/lib/scene-composition";
import type { VariableOption } from "@/lib/workflow-variables";
import { CanvasSummary } from "./canvas-summary";
import { CanvasWidgetHandle } from "./canvas-widget-handle";
import { WidgetBehaviorsSection } from "./widget-behaviors-section";
import { WidgetFallbackBackground } from "./widget-fallback-background";
import { WidgetSettingsPanel } from "./widget-settings-panel";

const ALERT_SURFACE = "alert";

interface WidgetLayoutCanvasProps {
  editor: CompositionEditor;
  /** The editor's state, as the caller subscribed to it. */
  state: EditorState;
  /** The installed widgets: their settings fields, icons and which host alerts. The editor decides which may be added. */
  catalog: readonly SceneWidgetCatalogRow[];
  renderers: Record<string, CustomFieldRenderer>;
  /** What text in a widget's settings may reference. A scene has no workflow around it, so it passes none. */
  availableVariables?: VariableOption[];
  /** Real widget pixels, drawn over the placeholders and under the handles. */
  preview?: ReactNode;
  /** Drawn in place of a widget's generic placeholder. */
  placeholder?: (node: NodeView) => ReactNode;
  /** The editor's title bar. Omitted where this is embedded in a dialog that has its own. */
  header?: ReactNode;
  /** See OverlayEditorShell.className: how the editor claims its height. */
  className?: string;
  /** Other editors working on this canvas, by the widget each has selected. */
  remoteSelections?: Record<string, RemoteSelection[]>;
  /** See OverlayEditorShell.readOnly. */
  readOnly?: boolean;
  /** Told when the editor refused a change made here, with its reason. */
  onRefused: (result: CommandResult) => void;
}

/** A layer as the layers list shows it. */
interface NodeLayer {
  id: string;
  visible: boolean;
  locked: boolean;
  node: NodeView;
}

/**
 * A canvas for placing widgets, drawn from a composition editor's state
 * (`@woofx3/scene/editor`): the widget palette, the scaled canvas with a
 * drag/resize handle per widget and the editor's snap guides, the layers,
 * and the selected widget's settings. Every change goes to the editor, which
 * decides what it does to the document; this saves nothing itself.
 */
export function WidgetLayoutCanvas({
  editor,
  state,
  catalog,
  renderers,
  availableVariables,
  preview,
  placeholder,
  header,
  className,
  remoteSelections,
  readOnly = false,
  onRefused,
}: WidgetLayoutCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const settings = useMemo(() => (state.doc === null ? null : canvasSettingsOf(state.doc)), [state.doc]);
  const width = settings?.width ?? 1920;
  const height = settings?.height ?? 1080;
  const background = settings?.backgroundColor ?? "transparent";
  const canvasSize = useMemo(() => ({ width, height }), [width, height]);
  const nodes = state.view.nodes;
  const zoom = state.viewport.zoom;

  const rowFor = useCallback((widgetId: string) => catalog.find((row) => row.widgetId === widgetId), [catalog]);
  const labelOf = useCallback(
    (node: NodeView) =>
      rowFor(node.placement.widget)?.hostsSurface === ALERT_SURFACE
        ? `${node.placement.name} · ${alertWidgetName(node.placement.settings)}`
        : node.placement.name,
    [rowFor]
  );
  const paletteRows = useMemo(() => {
    const placeable = new Set(state.palette.map((row) => row.widgetId));
    return catalog.filter((row) => placeable.has(row.widgetId));
  }, [catalog, state.palette]);

  const report = useCallback(
    (result: CommandResult) => {
      if (!result.ok) {
        onRefused(result);
      }
    },
    [onRefused]
  );

  const onMeasure = useCallback((size: CanvasSize) => editor.viewport.setStage(size), [editor]);
  const zoomControl: StageZoom = useMemo(
    () => ({
      zoom,
      fit: state.viewport.fit,
      onMeasure,
      zoomIn: () => editor.dispatch("view.zoomIn"),
      zoomOut: () => editor.dispatch("view.zoomOut"),
      zoomToFit: () => editor.dispatch("view.zoomFit"),
    }),
    [editor, zoom, state.viewport.fit, onMeasure]
  );

  const canvasOrigin = useCallback((): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect === undefined ? { x: 0, y: 0 } : { x: rect.left, y: rect.top };
  }, []);

  // Deselects on mousedown, not click, and only when the press landed directly on
  // one of the canvas's own background layers.
  //
  // Click is the wrong event here: pressing a widget selects it on mousedown and
  // starts a drag, and the drag moves the widget out from under the cursor — so
  // mousedown and mouseup land on different elements and the browser dispatches
  // the resulting click on their common ancestor, which IS one of these background
  // layers. That made every press-and-twitch on a widget select it and immediately
  // deselect it: the settings panel flashed open and shut. Mousedown carries no
  // such ambiguity, and widget handles already stop it propagating.
  const handleBackgroundMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        editor.dispatch("selection.clear");
      }
    },
    [editor]
  );

  const layers = useMemo(
    (): NodeLayer[] =>
      [...nodes]
        .reverse()
        .map((node) => ({ id: node.id, visible: node.placement.visible, locked: node.placement.locked, node })),
    [nodes]
  );
  const moveLayer = useCallback(
    (id: string, toIndex: number) => report(editor.nodes.reorder(id, { index: nodes.length - 1 - toIndex })),
    [editor, nodes.length, report]
  );
  const toggleVisible = useCallback(
    (id: string) => {
      const placement = editor.getState().doc?.widgets[id];
      if (placement !== undefined) {
        report(editor.nodes.patch(id, { visible: !placement.visible }));
      }
    },
    [editor, report]
  );
  const toggleLocked = useCallback(
    (id: string) => {
      const placement = editor.getState().doc?.widgets[id];
      if (placement !== undefined) {
        report(editor.nodes.patch(id, { locked: !placement.locked }));
      }
    },
    [editor, report]
  );

  const selected = nodes.find((node) => node.id === state.selection.primary) ?? null;
  const selectedRow = selected ? rowFor(selected.placement.widget) : undefined;
  const selectedFields = (selectedRow?.settings ?? []) as ConfigField[];

  return (
    <OverlayEditorShell
      canvas={canvasSize}
      className={className}
      readOnly={readOnly}
      header={header}
      zoomControl={zoomControl}
      stageToolbar={`${width} × ${height}`}
      onDeselect={() => editor.dispatch("selection.clear")}
      palette={
        <WidgetPalette
          widgets={paletteRows}
          onAdd={(row) => report(editor.nodes.add(row.widgetId))}
          layout="grid"
          emptyMessage="No scene widgets are installed."
        />
      }
      layers={
        <LayersList
          layers={layers}
          selectedId={state.selection.primary}
          label={(layer) => labelOf(layer.node)}
          taxonomyOf={(layer) => rowFor(layer.node.placement.widget)?.taxonomy}
          onSelect={(id) => editor.dispatch("selection.select", { id })}
          onMove={moveLayer}
          onDelete={(id) => report(editor.nodes.remove([id]))}
          onToggleVisible={state.capabilities.canHide ? toggleVisible : undefined}
          onToggleLock={toggleLocked}
          emptyMessage="Nothing on the canvas yet. Add a widget to start."
        />
      }
      stage={(stageZoom) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets
        <div
          className={CANVAS_STAGE_CLASS}
          style={{ width: width * stageZoom, height: height * stageZoom, background }}
          onMouseDown={handleBackgroundMouseDown}
          data-testid="scene-canvas"
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
          <div
            ref={canvasRef}
            style={{ transform: `scale(${stageZoom})`, transformOrigin: "top left", width, height }}
            onMouseDown={handleBackgroundMouseDown}
          >
            {nodes.map((node) => (
              <WidgetFallbackBackground
                key={node.id}
                box={node.box}
                opacity={node.placement.opacity}
                label={labelOf(node)}
              >
                {placeholder?.(node)}
              </WidgetFallbackBackground>
            ))}
            {preview}
            {nodes.map((node, rank) => (
              <CanvasWidgetHandle
                key={node.id}
                node={node}
                editor={editor}
                zoom={stageZoom}
                rank={rank}
                remote={remoteSelections?.[node.id]}
                canvasOrigin={canvasOrigin}
                onRefused={onRefused}
              />
            ))}
            {state.guides.map((guide) => (
              <SnapGuide
                key={`${guide.axis}-${guide.position}-${guide.source}`}
                guide={guide}
                zoom={stageZoom}
                above={nodes.length + 10}
              />
            ))}
          </div>
        </div>
      )}
      inspector={
        selected ? (
          <WidgetSettingsPanel
            widgetCanonicalId={selected.placement.widget}
            settings={selected.placement.settings}
            fields={selectedFields}
            renderers={renderers}
            availableVariables={availableVariables}
            onChangeSetting={(key, value) => report(editor.nodes.patch(selected.id, { settings: { [key]: value } }))}
          >
            {state.doc !== null && (
              <WidgetBehaviorsSection
                editor={editor}
                behaviors={state.doc.behaviors}
                nodeId={selected.id}
                row={selectedRow === undefined ? undefined : catalogWidgetOf(selectedRow)}
                anchors={state.capabilities.anchors}
                disabled={readOnly || state.capabilities.readOnly}
                onRefused={onRefused}
              />
            )}
          </WidgetSettingsPanel>
        ) : null
      }
      inspectorFallback={<CanvasSummary width={width} height={height} count={nodes.length} />}
    />
  );
}

/** A line a dragged widget snapped to, one screen pixel wide at any zoom. */
function SnapGuide({ guide, zoom, above }: { guide: Guide; zoom: number; above: number }) {
  const style =
    guide.axis === "vertical"
      ? { left: guide.position, top: 0, bottom: 0, width: 1 / zoom, zIndex: above }
      : { top: guide.position, left: 0, right: 0, height: 1 / zoom, zIndex: above };
  return <div className="pointer-events-none absolute bg-pink-400" style={style} data-testid="snap-guide" />;
}
