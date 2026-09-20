import { alertWidgetName, nextAlertWidgetName } from "@convex/lib/alertWidgets";
import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { LayersList } from "@/components/overlay-editor/layers-list";
import { OverlayEditorShell } from "@/components/overlay-editor/overlay-editor-shell";
import { WidgetPalette } from "@/components/overlay-editor/widget-palette";
import type { VariableOption } from "@/lib/workflow-variables";
import type { Widget } from "@/types";
import { CanvasWidgetHandle } from "./canvas-widget-handle";
import { WidgetFallbackBackground } from "./widget-fallback-background";
import { WidgetSettingsPanel } from "./widget-settings-panel";

export type WidgetsUpdate = (widgets: Widget[]) => Widget[];

const ALERT_SURFACE = "alert";

interface WidgetLayoutCanvasProps {
  width: number;
  height: number;
  widgets: Widget[];
  /** The widgets that may be placed here, already narrowed to this canvas's surface. */
  catalog: SceneWidgetCatalogRow[];
  renderers: Record<string, CustomFieldRenderer>;
  /** What text in a widget's settings may reference. A scene has no workflow around it, so it passes none. */
  availableVariables?: VariableOption[];
  /** An `add` is reported apart from every other edit, for a caller that saves as soon as a widget is added. */
  onChange: (update: WidgetsUpdate, change: "add" | "edit") => void;
  /** Real widget pixels, drawn over the placeholders and under the handles. */
  preview?: ReactNode;
  /** Drawn in place of a widget's generic placeholder. */
  placeholder?: (widget: Widget) => ReactNode;
  /** The editor's title bar. Omitted where this is embedded in a dialog that has its own. */
  header?: ReactNode;
  /** See OverlayEditorShell.className: how the editor claims its height. */
  className?: string;
}

/**
 * A canvas for placing widgets: the widget palette, the scaled canvas with a
 * drag/resize handle per widget, and the selected widget's settings. It edits
 * what it is handed and saves nothing, so a scene and an alert layout share it.
 */
export function WidgetLayoutCanvas({
  width,
  height,
  widgets,
  catalog,
  renderers,
  availableVariables,
  onChange,
  preview,
  placeholder,
  header,
  className,
}: WidgetLayoutCanvasProps) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  // StageArea re-observes whenever this identity changes, so it is not rebuilt per render.
  const canvasSize = useMemo(() => ({ width, height }), [width, height]);

  const catalogRowFor = useCallback(
    (widget: Widget) => catalog.find((row) => row.widgetId === widget.widgetCanonicalId),
    [catalog]
  );
  const isAlertWidget = useCallback(
    (widget: Widget) => catalogRowFor(widget)?.hostsSurface === ALERT_SURFACE,
    [catalogRowFor]
  );

  const editWidget = useCallback(
    (widgetId: string, change: (widget: Widget) => Widget) => {
      onChange((prev) => prev.map((w) => (w.id === widgetId ? change(w) : w)), "edit");
    },
    [onChange]
  );

  const addWidget = useCallback(
    (canonicalId: string, displayName: string) => {
      const row = catalog.find((r) => r.widgetId === canonicalId);
      const defaults: Record<string, unknown> = {};
      for (const field of (row?.settings ?? []) as ConfigField[]) {
        if (field.defaultValue !== undefined) {
          defaults[field.id] = field.defaultValue;
        }
      }
      const id = `w-${Date.now()}`;
      onChange((prev) => {
        const settings =
          row?.hostsSurface === ALERT_SURFACE
            ? {
                ...defaults,
                name: nextAlertWidgetName(prev.filter(isAlertWidget).map((w) => alertWidgetName(w.settings))),
              }
            : defaults;
        const widget: Widget = {
          id,
          widgetCanonicalId: canonicalId,
          name: displayName,
          position: { x: 100, y: 100 },
          size: { width: 300, height: 200 },
          rotation: 0,
          opacity: 100,
          zIndex: prev.length + 1,
          locked: false,
          visible: true,
          settings,
        };
        return [...prev, widget];
      }, "add");
      setSelectedWidgetId(id);
    },
    [catalog, onChange, isAlertWidget]
  );

  const deleteWidget = useCallback(
    (widgetId: string) => {
      onChange((prev) => prev.filter((w) => w.id !== widgetId), "edit");
      setSelectedWidgetId((id) => (id === widgetId ? null : id));
    },
    [onChange]
  );

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
  const handleBackgroundMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedWidgetId(null);
    }
  }, []);

  const selectedWidget = widgets.find((w) => w.id === selectedWidgetId) ?? null;
  const selectedWidgetFields = (selectedWidget ? (catalogRowFor(selectedWidget)?.settings ?? []) : []) as ConfigField[];

  const layersNewestFirst = [...widgets].sort((a, b) => b.zIndex - a.zIndex);
  const taxonomyOf = useCallback((widget: Widget) => catalogRowFor(widget)?.taxonomy, [catalogRowFor]);

  return (
    <OverlayEditorShell
      canvas={canvasSize}
      className={className}
      header={header}
      palette={
        <WidgetPalette
          widgets={catalog}
          onAdd={(row) => addWidget(row.widgetId, row.name)}
          layout="grid"
          emptyMessage="No scene widgets are installed."
        />
      }
      layers={
        <LayersList
          layers={layersNewestFirst}
          selectedId={selectedWidgetId}
          label={(widget) =>
            isAlertWidget(widget) ? `${widget.name} · ${alertWidgetName(widget.settings)}` : widget.name
          }
          taxonomyOf={taxonomyOf}
          onSelect={setSelectedWidgetId}
          emptyMessage="Nothing on the canvas yet. Add a widget to start."
        />
      }
      stage={(zoom) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets
        <div
          className="relative shrink-0 overflow-hidden bg-[#050507] shadow-lg"
          style={{ width: width * zoom, height: height * zoom }}
          onMouseDown={handleBackgroundMouseDown}
          data-testid="scene-canvas"
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width, height }}
            onMouseDown={handleBackgroundMouseDown}
          >
            {widgets.map((widget) => (
              <WidgetFallbackBackground
                key={widget.id}
                widget={widget}
                label={isAlertWidget(widget) ? `${widget.name} · ${alertWidgetName(widget.settings)}` : undefined}
              >
                {placeholder?.(widget)}
              </WidgetFallbackBackground>
            ))}
            {preview}
            {widgets.map((widget) => (
              <CanvasWidgetHandle
                key={widget.id}
                widget={widget}
                isSelected={selectedWidgetId === widget.id}
                scale={zoom}
                onSelect={() => setSelectedWidgetId(widget.id)}
                onMove={(dx, dy) =>
                  editWidget(widget.id, (w) => ({
                    ...w,
                    position: { x: Math.max(0, w.position.x + dx), y: Math.max(0, w.position.y + dy) },
                  }))
                }
                onResize={(w, h) => editWidget(widget.id, (prev) => ({ ...prev, size: { width: w, height: h } }))}
              />
            ))}
          </div>
        </div>
      )}
      inspector={
        selectedWidget ? (
          <WidgetSettingsPanel
            widget={selectedWidget}
            fields={selectedWidgetFields}
            renderers={renderers}
            availableVariables={availableVariables}
            onChangeSetting={(key, value) =>
              editWidget(selectedWidget.id, (w) => ({ ...w, settings: { ...w.settings, [key]: value } }))
            }
            onDelete={() => deleteWidget(selectedWidget.id)}
          />
        ) : null
      }
      inspectorFallback={<CanvasSummary width={width} height={height} count={widgets.length} />}
    />
  );
}

/** What the right rail shows with nothing selected, so the rail is never blank. */
function CanvasSummary({ width, height, count }: { width: number; height: number; count: number }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">Canvas</h2>
      <p className="text-xs text-muted-foreground">
        Select a widget on the canvas to edit it, or add one from the left.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Size</dt>
        <dd className="font-mono text-xs leading-5">
          {width} × {height}
        </dd>
        <dt className="text-muted-foreground">Widgets</dt>
        <dd className="font-mono text-xs leading-5">{count}</dd>
      </dl>
    </div>
  );
}
