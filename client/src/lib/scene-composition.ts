import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";
import type { CatalogWidget, Peer } from "@woofx3/scene/editor";
import { type CompositionDocument, evenKeys, type PlacementDocument, stackOrder } from "@woofx3/scene/model";
import type { Scene, Widget } from "@/types";

/**
 * The dashboard's side of the composition editor (`@woofx3/scene/editor`):
 * converting between a composition and the form Convex caches a scene in,
 * the catalog the editor places widgets from, and what the canvas shows of
 * other editors. Editing itself is the editor's.
 */

/** The canvas a scene's layout declares, with the defaults a scene is created with. */
export interface CanvasSettings {
  width: number;
  height: number;
  backgroundColor: string;
}

/** The parts of a cached scene that make up its composition. */
export type StoredScene = Pick<Scene, "width" | "height" | "backgroundColor" | "widgets">;

/**
 * A scene as Convex caches it (`widgetsJson`, an array) as a composition.
 * Stacking follows `zIndex`, ties broken by array order, which is the order
 * the scene manager stacks a saved scene in.
 */
export function compositionOfStoredScene(scene: StoredScene): CompositionDocument {
  const stacked = scene.widgets
    .map((widget, index) => ({ widget, index }))
    .sort((a, b) => a.widget.zIndex - b.widget.zIndex || a.index - b.index);
  const keys = evenKeys(stacked.length);
  const widgets: Record<string, PlacementDocument> = {};
  stacked.forEach(({ widget }, rank) => {
    widgets[widget.id] = {
      widget: widget.widgetCanonicalId,
      x: widget.position.x,
      y: widget.position.y,
      width: widget.size.width,
      height: widget.size.height,
      visible: widget.visible !== false,
      z: keys[rank] as string,
      settings: widget.settings ?? {},
      name: widget.name,
      rotation: widget.rotation ?? 0,
      opacity: widget.opacity ?? 1,
      locked: widget.locked === true,
      extra: {},
    };
  });
  return {
    layout: { width: scene.width, height: scene.height, backgroundColor: scene.backgroundColor },
    widgets,
    behaviors: {},
  };
}

/** A composition's placements in the form Convex caches them: bottom of the stack first, `zIndex` its rank. */
export function storedWidgetsOf(doc: CompositionDocument): Widget[] {
  return stackOrder(doc).map((id, zIndex) => {
    const placement = doc.widgets[id] as PlacementDocument;
    return {
      id,
      widgetCanonicalId: placement.widget,
      name: placement.name,
      position: { x: placement.x, y: placement.y },
      size: { width: placement.width, height: placement.height },
      rotation: placement.rotation,
      opacity: placement.opacity,
      zIndex,
      locked: placement.locked,
      visible: placement.visible,
      settings: placement.settings,
    };
  });
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function canvasSettingsOf(doc: CompositionDocument): CanvasSettings {
  return {
    width: numberOr(doc.layout.width, 1920),
    height: numberOr(doc.layout.height, 1080),
    backgroundColor: typeof doc.layout.backgroundColor === "string" ? doc.layout.backgroundColor : "transparent",
  };
}

/** What `updateScene` and `createScene` take for a composition. */
export function storedSceneJson(doc: CompositionDocument): { widgetsJson: string; layoutJson: string } {
  return {
    widgetsJson: JSON.stringify(storedWidgetsOf(doc)),
    layoutJson: JSON.stringify(canvasSettingsOf(doc)),
  };
}

/** The installed widgets as the editor's catalog. */
export function catalogOfRows(rows: readonly SceneWidgetCatalogRow[]): CatalogWidget[] {
  return rows.map(catalogWidgetOf);
}

/** One installed widget as the editor's catalog lists it, with the behavior kinds it declares. */
export function catalogWidgetOf(row: SceneWidgetCatalogRow): CatalogWidget {
  return {
    widgetId: row.widgetId,
    name: row.name,
    settings: row.settings as CatalogWidget["settings"],
    ...(row.surfaces !== undefined ? { surfaces: row.surfaces } : {}),
    ...(row.hostsSurface !== undefined ? { hostsSurface: row.hostsSurface } : {}),
    ...(row.behaviorKinds !== undefined ? { behaviorKinds: row.behaviorKinds } : {}),
  };
}

/** Another editor that has a widget selected. */
export interface RemoteSelection {
  name: string;
  /** Any CSS color, the same for that editor everywhere on the canvas. */
  color: string;
}

/** Other editors' selections by the widget each has selected. */
export function remoteSelectionsOf(peers: readonly Peer[]): Record<string, RemoteSelection[]> {
  const byWidget: Record<string, RemoteSelection[]> = {};
  for (const peer of peers) {
    if (peer.selection !== null) {
      const editors = byWidget[peer.selection] ?? [];
      editors.push({ name: peer.name, color: editorColor(peer.id) });
      byWidget[peer.selection] = editors;
    }
  }
  return byWidget;
}

/** A colour for another editor, the same for as long as it is connected. */
export function editorColor(editorId: string): string {
  let hash = 0;
  for (const char of editorId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hsl(${hash % 360} 75% 45%)`;
}
