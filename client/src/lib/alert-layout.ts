import type { Widget } from "@/types";

/** The canvas a new alert layout starts on. */
export const DEFAULT_ALERT_CANVAS = { width: 1920, height: 1080 } as const;

/**
 * An Alert step's `layout` parameter: widgets placed on a canvas, which each
 * alert widget scales to fit. The scene manager reads `width`, `height` and,
 * per widget, `id`, `widgetCanonicalId`, `position`, `size` and `settings`.
 */
export interface AlertLayout {
  width: number;
  height: number;
  widgets: Widget[];
}

/**
 * Read a stored `layout` into editor widgets. A layout written by hand or by
 * a module manifest carries only what the scene manager reads, so the
 * editor-only fields get defaults, and stacking follows array order — the
 * order the scene manager stacks in.
 */
export function readAlertLayout(raw: unknown, nameOf: (widgetCanonicalId: string) => string): AlertLayout {
  const value = isRecord(raw) ? raw : {};
  const entries = Array.isArray(value.widgets) ? value.widgets : [];
  const widgets = entries.filter(isRecord).map((entry, index): Widget => {
    const widgetCanonicalId = typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "";
    const position = isRecord(entry.position) ? entry.position : {};
    const size = isRecord(entry.size) ? entry.size : {};
    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : `w-${index + 1}`,
      widgetCanonicalId,
      name: typeof entry.name === "string" && entry.name ? entry.name : nameOf(widgetCanonicalId),
      position: { x: numberOr(position.x, 0), y: numberOr(position.y, 0) },
      size: { width: numberOr(size.width, 300), height: numberOr(size.height, 200) },
      rotation: numberOr(entry.rotation, 0),
      opacity: numberOr(entry.opacity, 100),
      zIndex: index + 1,
      locked: entry.locked === true,
      visible: entry.visible !== false,
      settings: isRecord(entry.settings) ? entry.settings : {},
    };
  });
  return {
    width: positiveOr(value.width, DEFAULT_ALERT_CANVAS.width),
    height: positiveOr(value.height, DEFAULT_ALERT_CANVAS.height),
    widgets,
  };
}

/** The layout to store, with widgets in stacking order, since the scene manager stacks by array order. */
export function writeAlertLayout(layout: AlertLayout): AlertLayout {
  return { ...layout, widgets: [...layout.widgets].sort((a, b) => a.zIndex - b.zIndex) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
