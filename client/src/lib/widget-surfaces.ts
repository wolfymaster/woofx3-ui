import type { SceneWidgetCatalogRow } from "@convex/sceneWidgets";

/** Where a catalog widget may be placed. A row registered before widgets declared it is a scene widget. */
export function widgetSurfaces(row: Pick<SceneWidgetCatalogRow, "surfaces">): string[] {
  return row.surfaces ?? ["scene"];
}

/** The catalog widgets that may be placed on `surface`. */
export function placeableOn(catalog: SceneWidgetCatalogRow[], surface: string): SceneWidgetCatalogRow[] {
  return catalog.filter((row) => widgetSurfaces(row).includes(surface));
}
