import { type PlacementDocument, type SceneDocument, stackOrder, zKey } from "@/lib/scene-document";
import type { Widget } from "@/types";

/** The part of the editor's scene the document holds; name and description are the scene's own. */
export interface SceneCanvas {
  width: number;
  height: number;
  backgroundColor: string;
  widgets: Widget[];
}

/**
 * The editor's canvas as a scene document. `base` is the document the canvas
 * was last read from: fields the editor does not show (a placement's
 * `extra`, unknown layout keys) are carried over from it unchanged.
 * Stacking follows `zIndex`, ties broken by order in the list.
 */
export function documentOfCanvas(canvas: SceneCanvas, base: SceneDocument | null): SceneDocument {
  const stacked = canvas.widgets
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => a.widget.zIndex - b.widget.zIndex || a.index - b.index);
  const widgets: Record<string, PlacementDocument> = {};
  stacked.forEach(({ widget }, rank) => {
    widgets[widget.id] = {
      widget: widget.widgetCanonicalId,
      x: widget.position.x,
      y: widget.position.y,
      width: widget.size.width,
      height: widget.size.height,
      visible: widget.visible,
      z: zKey(rank),
      settings: widget.settings,
      name: widget.name,
      rotation: widget.rotation,
      opacity: widget.opacity,
      locked: widget.locked,
      extra: base?.widgets[widget.id]?.extra ?? {},
    };
  });
  return {
    layout: {
      ...(base?.layout ?? {}),
      width: canvas.width,
      height: canvas.height,
      backgroundColor: canvas.backgroundColor,
    },
    widgets,
  };
}

/**
 * A change to the editor's canvas as an edit of a scene document, for
 * `SceneSyncClient.edit`. `update` is handed the canvas of the document the
 * client holds when the edit is made, never a copy the editor kept, so an edit
 * made just after another editor's change cannot put that change back.
 */
export function canvasEdit(update: (canvas: SceneCanvas) => SceneCanvas): (doc: SceneDocument) => SceneDocument {
  return (doc) => documentOfCanvas(update(canvasOfDocument(doc)), doc);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A scene document as the editor's canvas, placements bottom first. */
export function canvasOfDocument(doc: SceneDocument): SceneCanvas {
  return {
    width: numberOr(doc.layout.width, 1920),
    height: numberOr(doc.layout.height, 1080),
    backgroundColor: typeof doc.layout.backgroundColor === "string" ? doc.layout.backgroundColor : "transparent",
    widgets: stackOrder(doc).map((id, zIndex) => {
      const p = doc.widgets[id]!;
      return {
        id,
        widgetCanonicalId: p.widget,
        name: p.name,
        position: { x: p.x, y: p.y },
        size: { width: p.width, height: p.height },
        rotation: p.rotation,
        opacity: p.opacity,
        zIndex,
        locked: p.locked,
        visible: p.visible,
        settings: p.settings,
      };
    }),
  };
}
