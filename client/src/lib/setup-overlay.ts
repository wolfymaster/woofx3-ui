import { DEFAULT_ALERT_WIDGET_NAME } from "@convex/lib/alertWidgets";
import type { Widget } from "@/types";

// The overlay setup creates for a streamer who has no scene yet: one
// full-screen alert widget, so alerts appear in OBS as soon as the browser
// source is added, without opening the scene editor first.

export const SETUP_OVERLAY_NAME = "Main overlay";
export const SETUP_OVERLAY_SIZE = { width: 1920, height: 1080 } as const;

/** Must match ALERT_SURFACE in client/src/components/scenes/widget-layout-canvas.tsx. */
const ALERT_SURFACE = "alert";

export interface WidgetCatalogEntry {
  widgetId: string;
  name: string;
  hostsSurface?: string;
  settings: readonly unknown[];
}

/** The catalog's alert widget: the one whose placements host alert layouts. */
export function findAlertWidget<T extends WidgetCatalogEntry>(catalog: readonly T[]): T | undefined {
  return catalog.find((row) => row.hostsSurface === ALERT_SURFACE);
}

function defaultSettings(settings: readonly unknown[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of settings) {
    if (field && typeof field === "object") {
      const { id, defaultValue } = field as { id?: unknown; defaultValue?: unknown };
      if (typeof id === "string" && defaultValue !== undefined) {
        defaults[id] = defaultValue;
      }
    }
  }
  return defaults;
}

/**
 * The widgets for the setup overlay: the alert widget covering the canvas,
 * named so an Alert action with no target plays on it. None when the engine
 * has not registered an alert widget, in which case the scene starts empty.
 */
export function setupOverlayWidgets(alertWidget: WidgetCatalogEntry | undefined): Widget[] {
  if (!alertWidget) {
    return [];
  }
  return [
    {
      id: "w-setup-alerts",
      widgetCanonicalId: alertWidget.widgetId,
      name: alertWidget.name,
      position: { x: 0, y: 0 },
      size: { ...SETUP_OVERLAY_SIZE },
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      visible: true,
      settings: { ...defaultSettings(alertWidget.settings), name: DEFAULT_ALERT_WIDGET_NAME },
    },
  ];
}
