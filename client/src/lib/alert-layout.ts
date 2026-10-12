import type { EngineCapability } from "@convex/lib/engineCapabilities";
import {
  type CompositionDocument,
  evenKeys,
  isPlainObject,
  type NodeId,
  normalizeComposition,
  type PlacementDocument,
  sameValue,
  stackOrder,
} from "@woofx3/scene/model";
import type { CapabilitySupport } from "@/lib/engine-capabilities";

/**
 * An Alert step's `layout` parameter, in both the shapes it is stored in.
 *
 * Alerts are compositions (`@woofx3/scene/model`): a canvas under `layout`,
 * widgets keyed by id with a fractional `z`, and behaviors. Steps saved
 * before that hold a canvas with a list of widgets, bottom of the stack
 * first, and an engine that predates compositions plays only that list. The
 * editor always works on a composition; this file converts on the way in
 * and picks the shape on the way out.
 *
 * `compositionOfLegacyAlert` and `alertCompositionOf` mirror the engine's
 * `model/legacy-alert.ts` (woofx3 branch feat/scene-overlay), name for name,
 * so this file can import them from `@woofx3/scene/model` once that lands.
 * This side additionally keeps the fields the dashboard writes into each
 * list entry (name, visibility, rotation, opacity, lock), which the engine's
 * conversion does not read.
 */

/** The canvas a new alert layout starts on. */
export const DEFAULT_ALERT_CANVAS = { width: 1920, height: 1080 } as const;

/**
 * The engine capability that says an alert step's `layout` may be a
 * composition. An engine without it gets the list shape.
 */
export const ALERT_COMPOSITION_CAPABILITY: EngineCapability = "alerts.compositionLayout";

/** The list-shaped layout's outer fields; each widget entry is read defensively. */
export interface LegacyAlertLayout {
  width: unknown;
  height: unknown;
  widgets: unknown[];
  [key: string]: unknown;
}

/** A list entry as this dashboard writes it, and as the scene manager reads `id`, `widgetCanonicalId`, `position`, `size` and `settings`. */
export interface LegacyAlertWidget {
  id: string;
  widgetCanonicalId: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;
  /** The entry's place in the stack, 1 at the bottom; the scene manager stacks by array order. */
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;
}

/** An entry of the old list that has no place in the composition. */
export interface LegacyAlertSkip {
  /** Its position in the list. */
  index: number;
  widgetCanonicalId: string;
  reason: string;
}

export interface LegacyAlertConversion {
  doc: CompositionDocument;
  /** The list index each converted widget came from. */
  indexOf: Record<NodeId, number>;
  skipped: LegacyAlertSkip[];
}

/** Whether `value` is a list-shaped alert layout: widgets in an array rather than keyed by id. */
export function isLegacyAlertLayout(value: unknown): value is LegacyAlertLayout {
  return isPlainObject(value) && Array.isArray(value.widgets);
}

/**
 * The composition a list-shaped alert layout describes. List order becomes
 * `z` keys, bottom first; every other key of the old layout becomes a key of
 * the canvas. An entry that is not an object, has no id, or repeats an
 * earlier id cannot be keyed by its id, and is skipped and reported.
 */
export function compositionOfLegacyAlert(legacy: LegacyAlertLayout): LegacyAlertConversion {
  const { widgets: entries, ...canvas } = legacy;
  const kept: Array<{ id: NodeId; index: number; entry: Record<string, unknown> }> = [];
  const skipped: LegacyAlertSkip[] = [];
  const seen = new Set<NodeId>();
  entries.forEach((raw, index) => {
    const entry = isPlainObject(raw) ? raw : {};
    const widgetCanonicalId = typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "";
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!isPlainObject(raw)) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget must be an object" });
      return;
    }
    if (id.length === 0) {
      skipped.push({ index, widgetCanonicalId, reason: "a layout widget needs an `id`" });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ index, widgetCanonicalId, reason: `duplicate id ${JSON.stringify(id)}` });
      return;
    }
    seen.add(id);
    kept.push({ id, index, entry });
  });

  const zKeys = evenKeys(kept.length);
  const widgets: Record<NodeId, PlacementDocument> = {};
  const indexOf: Record<NodeId, number> = {};
  kept.forEach(({ id, index, entry }, rank) => {
    widgets[id] = placementOfEntry(entry, zKeys[rank] as string);
    indexOf[id] = index;
  });
  return { doc: { layout: canvas, widgets, behaviors: {} }, indexOf, skipped };
}

/** An alert layout in either shape as a composition, or null when it is neither. */
export function alertCompositionOf(value: unknown): CompositionDocument | null {
  if (isLegacyAlertLayout(value)) {
    return compositionOfLegacyAlert(value).doc;
  }
  return normalizeComposition(value);
}

/**
 * A step's stored `layout`, whatever its shape, as the composition the
 * editor and the previews work on. Nothing stored (a new step) or something
 * unreadable is an empty alert; a canvas without a usable size gets the
 * default one; a widget stored without a name is named by `nameOf`, from
 * the catalog.
 */
export function readAlertComposition(raw: unknown, nameOf: (widgetCanonicalId: string) => string): CompositionDocument {
  const doc = alertCompositionOf(raw) ?? { layout: {}, widgets: {}, behaviors: {} };
  const widgets: Record<NodeId, PlacementDocument> = {};
  for (const [id, placement] of Object.entries(doc.widgets)) {
    widgets[id] = placement.name ? placement : { ...placement, name: nameOf(placement.widget) };
  }
  return {
    ...doc,
    layout: {
      ...doc.layout,
      width: positiveOr(doc.layout.width, DEFAULT_ALERT_CANVAS.width),
      height: positiveOr(doc.layout.height, DEFAULT_ALERT_CANVAS.height),
    },
    widgets,
  };
}

/**
 * The list shape of a composition, for an engine that plays only that.
 * Lossy: behaviors and inputs have nowhere to go and are dropped, and the
 * stack becomes array order, which is how the scene manager stacks.
 */
export function legacyAlertLayoutOf(doc: CompositionDocument): LegacyAlertLayout {
  const widgets = stackOrder(doc).map((id, rank): LegacyAlertWidget => {
    const placement = doc.widgets[id] as PlacementDocument;
    return {
      id,
      widgetCanonicalId: placement.widget,
      name: placement.name,
      position: { x: placement.x, y: placement.y },
      size: { width: placement.width, height: placement.height },
      rotation: placement.rotation,
      opacity: placement.opacity,
      zIndex: rank + 1,
      locked: placement.locked,
      visible: placement.visible,
      settings: placement.settings,
    };
  });
  return { ...doc.layout, width: doc.layout.width, height: doc.layout.height, widgets };
}

/** Which shape a step's `layout` is written in. */
export type AlertLayoutShape = "composition" | "list";

/**
 * The shape to write for an engine: a composition where the engine says it
 * plays one, else the list every engine plays. An engine still being asked,
 * or one that could not be asked, gets the list, which loses only behaviors.
 */
export function alertLayoutShapeFor(support: CapabilitySupport): AlertLayoutShape {
  return support === "supported" ? "composition" : "list";
}

/** What to store in a step's `layout` for `doc`, in `shape`. */
export function storedAlertLayout(doc: CompositionDocument, shape: AlertLayoutShape): unknown {
  return shape === "composition" ? structuredClone(doc) : legacyAlertLayoutOf(doc);
}

/** Whether the editor's document differs from the one it opened with. */
export function alertLayoutChanged(opened: CompositionDocument, current: CompositionDocument): boolean {
  return !sameValue(opened, current);
}

function placementOfEntry(entry: Record<string, unknown>, z: string): PlacementDocument {
  const position = isPlainObject(entry.position) ? entry.position : {};
  const size = isPlainObject(entry.size) ? entry.size : {};
  return {
    widget: typeof entry.widgetCanonicalId === "string" ? entry.widgetCanonicalId : "",
    x: numberOr(position.x, 0),
    y: numberOr(position.y, 0),
    width: numberOr(position.width, numberOr(size.width, 300)),
    height: numberOr(position.height, numberOr(size.height, 200)),
    visible: entry.visible !== false,
    z,
    settings: isPlainObject(entry.settings) ? entry.settings : {},
    name: typeof entry.name === "string" ? entry.name : "",
    rotation: numberOr(entry.rotation, 0),
    opacity: numberOr(entry.opacity, 1),
    locked: entry.locked === true,
    extra: {},
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
