import { alertWidgetName, nextAlertWidgetName } from "@convex/lib/alertWidgets";
import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import type { CustomFieldRenderer } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Widget } from "@/types";
import { CanvasWidgetHandle } from "./canvas-widget-handle";
import { WidgetCatalogSidebar } from "./widget-catalog-sidebar";
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
  /** An `add` is reported apart from every other edit, for a caller that saves as soon as a widget is added. */
  onChange: (update: WidgetsUpdate, change: "add" | "edit") => void;
  /** Real widget pixels, drawn over the placeholders and under the handles. */
  preview?: ReactNode;
  /** Drawn in place of a widget's generic placeholder. */
  placeholder?: (widget: Widget) => ReactNode;
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
  onChange,
  preview,
  placeholder,
}: WidgetLayoutCanvasProps) {
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.5);

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

  return (
    <div className="relative flex-1 flex overflow-hidden">
      <WidgetCatalogSidebar catalogWidgets={catalog} onAdd={addWidget} />

      {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
      <div className="flex-1 bg-muted/30 relative overflow-auto" onMouseDown={handleBackgroundMouseDown}>
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card rounded-md border p-1 z-10">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Button variant="ghost" size="icon" onClick={() => setZoom(0.5)} data-testid="button-fit">
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
        <div className="absolute inset-0 flex items-center justify-center p-8" onMouseDown={handleBackgroundMouseDown}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: canvas background press deselects widgets */}
          <div
            className="relative bg-black/80 shadow-2xl"
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
        </div>
      </div>

      {/* Floated rather than docked as a flex sibling: as a sibling it took width
          from the canvas, so selecting a widget resized the canvas and shifted the
          whole scene under the cursor mid-click. Overlaying leaves the canvas
          exactly where it was. */}
      {selectedWidget && (
        <div className="absolute inset-y-0 right-0 z-20 flex shadow-xl">
          <WidgetSettingsPanel
            widget={selectedWidget}
            fields={selectedWidgetFields}
            renderers={renderers}
            onChangeSetting={(key, value) =>
              editWidget(selectedWidget.id, (w) => ({ ...w, settings: { ...w.settings, [key]: value } }))
            }
            onDelete={() => deleteWidget(selectedWidget.id)}
          />
        </div>
      )}
    </div>
  );
}
