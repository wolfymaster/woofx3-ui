import {
  alertCompositionOf,
  type CompositionDocument,
  type LegacyAlertLayout,
  type NodeId,
  type PlacementDocument,
  sameValue,
  stackOrder,
} from "@woofx3/scene/model";

/**
 * An Alert step's `layout` parameter, in both the shapes it is stored in.
 *
 * Alerts are compositions (`@woofx3/scene/model`): a canvas under `layout`,
 * widgets keyed by id with a fractional `z`, and behaviors. Steps saved
 * before that hold a canvas with a list of widgets, bottom of the stack
 * first. The editor always works on a composition: this file converts a
 * list on the way in, and a step is always written back as a composition.
 *
 * The list-to-composition conversion is the engine's (`@woofx3/scene/model`),
 * which also reads the fields the dashboard writes into each list entry
 * (name, visibility, rotation, opacity, lock) and keeps unknown ones.
 */

/** The canvas a new alert layout starts on. */
export const DEFAULT_ALERT_CANVAS = { width: 1920, height: 1080 } as const;

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

/** What to store in a step's `layout` for `doc`: the composition, as a copy. */
export function storedAlertLayout(doc: CompositionDocument): unknown {
  return structuredClone(doc);
}

/** Whether the editor's document differs from the one it opened with. */
export function alertLayoutChanged(opened: CompositionDocument, current: CompositionDocument): boolean {
  return !sameValue(opened, current);
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
