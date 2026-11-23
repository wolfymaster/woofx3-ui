import type { ConfigField } from "@woofx3/api/ui-schema";
import {
  alertWidgetName,
  type CommandResult,
  type CompositionEditor,
  type EditorState,
  type NodeView,
} from "@woofx3/scene/editor";
import { type ReactNode, useCallback, useMemo } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { CANVAS_STAGE_CLASS } from "@/components/common/stage-area";
import { LayersList } from "@/components/overlay-editor/layers-list";
import { OverlayEditorShell } from "@/components/overlay-editor/overlay-editor-shell";
import { SnapGuides } from "@/components/overlay-editor/snap-guides";
import { WidgetPalette } from "@/components/overlay-editor/widget-palette";
import type { SceneWidgetCatalogRow } from "@/engine/types";
import { useOverlayStage } from "@/hooks/use-overlay-stage";
import { canvasSettingsOf, catalogWidgetOf, type RemoteSelection } from "@/lib/scene-composition";
import type { VariableOption } from "@/lib/workflow-variables";
import { CanvasSummary } from "./canvas-summary";
import { CanvasWidgetHandle } from "./canvas-widget-handle";
import { WidgetEffectsSection, WidgetTransitionsSection } from "./widget-behaviors-section";
import { WidgetFallbackBackground } from "./widget-fallback-background";
import { WidgetInspectorTabs } from "./widget-inspector-tabs";
import { WidgetSettingsForm } from "./widget-settings-panel";

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
  const settings = useMemo(() => (state.doc === null ? null : canvasSettingsOf(state.doc)), [state.doc]);
  const width = settings?.width ?? 1920;
  const height = settings?.height ?? 1080;
  const background = settings?.backgroundColor ?? "transparent";
  const canvasSize = useMemo(() => ({ width, height }), [width, height]);
  const nodes = state.view.nodes;

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

  const stage = useOverlayStage(editor, state, report);
  const { canvasRef, gestures, layers, moveLayer } = stage;

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
      zoomControl={stage.zoomControl ?? undefined}
      stageToolbar={`${width} × ${height}`}
      onDeselect={stage.deselect}
      palette={
        <WidgetPalette
          widgets={paletteRows}
          onAdd={(row) => report(editor.nodes.add(row.widgetId))}
          layout="grid"
          emptyMessage="No widgets available. Get some in Marketplace."
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
          onMouseDown={stage.deselectOnBackground}
          data-testid="scene-canvas"
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
          <div
            ref={canvasRef}
            style={{ transform: `scale(${stageZoom})`, transformOrigin: "top left", width, height }}
            onMouseDown={stage.deselectOnBackground}
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
                gestures={gestures}
                zoom={stageZoom}
                rank={rank}
                remote={remoteSelections?.[node.id]}
              />
            ))}
            <SnapGuides guides={stage.guides} zoom={stageZoom} zIndex={nodes.length + 10} />
          </div>
        </div>
      )}
      inspector={
        selected ? (
          <WidgetInspectorTabs
            idPrefix={`scene-${selected.id}`}
            settings={
              selectedFields.length === 0 ? null : (
                <WidgetSettingsForm
                  widgetCanonicalId={selected.placement.widget}
                  settings={selected.placement.settings}
                  fields={selectedFields}
                  renderers={renderers}
                  availableVariables={availableVariables}
                  onChangeSetting={(key, value) =>
                    report(editor.nodes.patch(selected.id, { settings: { [key]: value } }))
                  }
                />
              )
            }
            transitions={
              state.doc === null ? null : (
                <WidgetTransitionsSection
                  editor={editor}
                  behaviors={state.doc.behaviors}
                  nodeId={selected.id}
                  row={selectedRow === undefined ? undefined : catalogWidgetOf(selectedRow)}
                  anchors={state.capabilities.anchors}
                  disabled={readOnly || state.capabilities.readOnly}
                  onRefused={onRefused}
                />
              )
            }
            effects={
              state.doc === null ? null : (
                <WidgetEffectsSection
                  editor={editor}
                  behaviors={state.doc.behaviors}
                  nodeId={selected.id}
                  row={selectedRow === undefined ? undefined : catalogWidgetOf(selectedRow)}
                  anchors={state.capabilities.anchors}
                  disabled={readOnly || state.capabilities.readOnly}
                  onRefused={onRefused}
                />
              )
            }
          />
        ) : null
      }
      inspectorFallback={<CanvasSummary width={width} height={height} count={nodes.length} />}
    />
  );
}
