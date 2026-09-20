import type { ConfigField } from "@woofx3/api/ui-schema";
import type { Widget } from "@/types";

/**
 * Geometry and defaults for the alert editor.
 *
 * A layout stores each widget by its top-left corner and size, which is what the scene
 * manager frames. The editor works in centers instead, the way the design places
 * layers: dragging, snapping and the X/Y fields all move a widget's center, and
 * `withCenter` converts back. Everything is in canvas pixels; the stage's zoom never
 * reaches a stored value.
 */

export interface Point {
  x: number;
  y: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/** The zoom levels the − and + buttons step through. */
export const ZOOM_STEPS = [0.2, 0.25, 0.3, 0.36, 0.5, 0.75, 1] as const;

/** How close to the canvas center, in canvas pixels, a drag snaps to it; farther on touch. */
export const SNAP_DISTANCE = 20;
export const SNAP_DISTANCE_TOUCH = 40;

export type LayerKind = "text" | "image" | "video" | "audio" | "lottie" | "other";

/** The bundled alert widgets the editor has a dedicated inspector and defaults for. */
const KIND_BY_WIDGET_ID: Record<string, LayerKind> = {
  "woofx3:widget:text": "text",
  "woofx3:widget:image": "image",
  "woofx3:widget:video": "video",
  "woofx3:widget:audio": "audio",
  "woofx3:widget:lottie": "lottie",
};

/**
 * Seconds a new layer plays. Zero is a real setting — the widget completes at once,
 * or a media widget plays through — but a layer that ends the moment it starts makes
 * an alert that flashes, so new layers start with a length of their own.
 */
const DEFAULT_DURATION: Record<LayerKind, number> = {
  text: 5,
  image: 5,
  video: 8,
  audio: 3,
  lottie: 4,
  other: 5,
};

/** Media layers keep a 16:9 box; the Width field sets both sides. */
export const MEDIA_ASPECT = 9 / 16;

/** Audio has nothing to draw, so it sits out of the way in the top right as a small marker. */
const AUDIO_CENTER: Point = { x: 1780, y: 60 };
const AUDIO_SIZE = { width: 200, height: 80 };

/** A new layer's offset step, so adding the same widget twice doesn't stack it exactly. */
const ADD_OFFSET = 40;

export function layerKind(widget: Pick<Widget, "widgetCanonicalId">): LayerKind {
  return KIND_BY_WIDGET_ID[widget.widgetCanonicalId] ?? "other";
}

export function centerOf(widget: Pick<Widget, "position" | "size">): Point {
  return { x: widget.position.x + widget.size.width / 2, y: widget.position.y + widget.size.height / 2 };
}

/** The widget moved so its center is at `center`, kept on whole pixels. */
export function withCenter<T extends Pick<Widget, "position" | "size">>(widget: T, center: Point): T {
  return {
    ...widget,
    position: {
      x: Math.round(center.x - widget.size.width / 2),
      y: Math.round(center.y - widget.size.height / 2),
    },
  };
}

/** A center kept on the canvas. The widget may hang over the edge; its center may not. */
export function clampCenter(center: Point, canvas: CanvasSize): Point {
  return {
    x: Math.min(canvas.width, Math.max(0, center.x)),
    y: Math.min(canvas.height, Math.max(0, center.y)),
  };
}

export interface Snapped {
  center: Point;
  /** Snapped onto the vertical center line, x = width / 2. */
  onVertical: boolean;
  /** Snapped onto the horizontal center line, y = height / 2. */
  onHorizontal: boolean;
}

/** Pulls a center within `distance` of either canvas center line onto it. */
export function snapToCenter(center: Point, canvas: CanvasSize, distance: number): Snapped {
  const midX = canvas.width / 2;
  const midY = canvas.height / 2;
  const onVertical = Math.abs(center.x - midX) <= distance;
  const onHorizontal = Math.abs(center.y - midY) <= distance;
  return {
    center: { x: onVertical ? midX : center.x, y: onHorizontal ? midY : center.y },
    onVertical,
    onHorizontal,
  };
}

export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? ZOOM_STEPS[0];
}

/** The zoom that fits the whole canvas in a box, leaving `padding` on every side. */
export function fitZoom(box: CanvasSize, canvas: CanvasSize, padding: number): number {
  const zoom = Math.min((box.width - padding * 2) / canvas.width, (box.height - padding * 2) / canvas.height);
  return Math.max(ZOOM_STEPS[0] / 4, zoom);
}

export function durationOf(widget: Pick<Widget, "settings">): number {
  const value = widget.settings.duration;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** How long the alert plays: until its longest layer ends. Zero when no layer has a length. */
export function alertLengthSeconds(widgets: readonly Pick<Widget, "settings">[]): number {
  return widgets.reduce((longest, widget) => Math.max(longest, durationOf(widget)), 0);
}

/** The one layer that sets the alert's length, when there is exactly one longest. */
export function longestLayerId(widgets: readonly Pick<Widget, "id" | "settings">[]): string | undefined {
  const length = alertLengthSeconds(widgets);
  const longest = widgets.filter((widget) => length > 0 && durationOf(widget) === length);
  return longest.length === 1 ? longest[0].id : undefined;
}

/**
 * The Text widget draws in a box the scene manager frames, so a box too short clips
 * the text. The box grows with the font size and the line count; its width is the
 * user's to set, and wrapping inside it is not predicted.
 */
export function textBoxHeight(fontSize: number, text: string): number {
  const lines = Math.max(1, text.split("\n").length);
  return Math.ceil(lines * fontSize * 1.25 + 16);
}

export interface CatalogWidget {
  widgetId: string;
  name: string;
  settings: unknown[];
}

/**
 * A new layer for a catalog widget: the widget's declared defaults, a length of its own,
 * centered on the canvas and stepped off the layers already there.
 */
export function newLayer(row: CatalogWidget, existing: readonly Widget[], canvas: CanvasSize): Widget {
  const kind = layerKind({ widgetCanonicalId: row.widgetId });
  const settings: Record<string, unknown> = {};
  for (const field of row.settings as ConfigField[]) {
    if (field.defaultValue !== undefined) {
      settings[field.id] = field.defaultValue;
    }
  }
  settings.duration = DEFAULT_DURATION[kind];
  if (kind === "text") {
    settings.text = "New text";
    settings.fontSize = 48;
    settings.color = "#ffffff";
  }

  const size =
    kind === "audio"
      ? AUDIO_SIZE
      : kind === "text"
        ? { width: 1200, height: textBoxHeight(48, "New text") }
        : { width: 640, height: Math.round(640 * MEDIA_ASPECT) };
  const offset = ADD_OFFSET * (existing.length % 4);
  const center = kind === "audio" ? AUDIO_CENTER : { x: canvas.width / 2 + offset, y: canvas.height / 2 + offset };

  const widget: Widget = {
    id: nextLayerId(existing),
    widgetCanonicalId: row.widgetId,
    name: row.name,
    position: { x: 0, y: 0 },
    size,
    rotation: 0,
    opacity: 100,
    zIndex: existing.reduce((top, w) => Math.max(top, w.zIndex), 0) + 1,
    locked: false,
    visible: true,
    settings,
  };
  return withCenter(widget, center);
}

/** The scene manager holds layout widget ids to a URL-safe token, since they end up in frame URLs. */
function nextLayerId(existing: readonly Widget[]): string {
  const used = new Set(existing.map((widget) => widget.id));
  let index = existing.length + 1;
  while (used.has(`w-${index}`)) {
    index += 1;
  }
  return `w-${index}`;
}
