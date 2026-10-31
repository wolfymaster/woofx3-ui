import { type ComponentType, createContext, type ReactNode, useContext } from "react";
import type { DashboardWidgetCategory, DashboardWidgetDefinition } from "./types";

/**
 * A rail entry the dashboard supplies itself rather than the user placing it:
 * always first, never moved or removed in edit mode, and gone once its hook
 * answers null.
 */
export interface RailPinnedItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Draws a dot on the icon: "attention" for something to do, "problem" for something wrong. */
  dot: "attention" | "problem" | null;
  content: ReactNode;
}

/**
 * What the dashboard offers in one mode of the app. The hosted app and the
 * desktop app's local mode each build one, and only the widgets a mode can
 * serve are in its catalog, so a mode's import tree holds nothing it cannot
 * run. A saved layout may still name a widget the mode lacks; the dashboard
 * shows a placeholder for it.
 */
export interface DashboardCatalog {
  /** Every widget the picker offers, in the picker's order within each category. */
  widgets: readonly DashboardWidgetDefinition[];
  /**
   * The rail's pinned entry. A hook, called on every render of the rail, so
   * a catalog keeps the same one for its whole life.
   */
  usePinnedRailItem: () => RailPinnedItem | null;
  /** Shown above the panels, under the command bar; null shows nothing. */
  Notice: ComponentType | null;
}

/** For a mode with no pinned rail entry. */
export function noPinnedRailItem(): RailPinnedItem | null {
  return null;
}

/**
 * Saved types whose widget was replaced, and the type that renders them now.
 * Panels keep the saved type (and its config) and render the replacement; the
 * picker offers only the replacement.
 */
const REPLACED_WIDGET_TYPES: Record<string, string> = {
  "live-events": "events",
  "alert-log": "events",
};

/** The definition that renders a saved widget type, following replaced types; undefined when `catalog` lacks it. */
export function findDashboardWidget(catalog: DashboardCatalog, type: string): DashboardWidgetDefinition | undefined {
  const resolved = REPLACED_WIDGET_TYPES[type] ?? type;
  return catalog.widgets.find((widget) => widget.type === resolved);
}

export const dashboardWidgetCategoryLabels: Record<DashboardWidgetCategory, string> = {
  stream: "Stream",
  automation: "Automation",
  utility: "Utility",
};

export function dashboardWidgetsByCategory(catalog: DashboardCatalog): Array<{
  category: DashboardWidgetCategory;
  label: string;
  widgets: DashboardWidgetDefinition[];
}> {
  const categories: DashboardWidgetCategory[] = ["stream", "automation", "utility"];
  return categories.map((category) => ({
    category,
    label: dashboardWidgetCategoryLabels[category],
    widgets: catalog.widgets.filter((widget) => widget.category === category),
  }));
}

const DashboardCatalogContext = createContext<DashboardCatalog | null>(null);

/** Mounted by each mode's dashboard route with that mode's catalog. */
export function DashboardCatalogProvider({ catalog, children }: { catalog: DashboardCatalog; children: ReactNode }) {
  return <DashboardCatalogContext.Provider value={catalog}>{children}</DashboardCatalogContext.Provider>;
}

/** The catalog of the mode the dashboard runs in. Throws outside a `DashboardCatalogProvider`. */
export function useDashboardCatalog(): DashboardCatalog {
  const catalog = useContext(DashboardCatalogContext);
  if (!catalog) {
    throw new Error("useDashboardCatalog must be used inside a DashboardCatalogProvider");
  }
  return catalog;
}
