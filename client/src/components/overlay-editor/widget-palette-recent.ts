export const RECENT_SECTION_KEY = "recent";
export const RECENT_SECTION_LABEL = "Recent";
/** Enough to save a few clicks without turning the top of the rail into a second catalog. */
export const RECENT_WIDGET_LIMIT = 6;

const STORAGE_KEY = "woofx3:widget-palette:recent";

/** Move a widget to the front, without duplicates and without growing without bound. */
export function pushRecentWidget(ids: readonly string[], widgetId: string): string[] {
  return [widgetId, ...ids.filter((id) => id !== widgetId)].slice(0, RECENT_WIDGET_LIMIT);
}

/** Stored ids that are still installed, in recency order. A removed widget drops out on its own. */
export function recentWidgetsOf<T extends { widgetId: string }>(ids: readonly string[], widgets: readonly T[]): T[] {
  const byId = new Map(widgets.map((widget) => [widget.widgetId, widget]));
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    const widget = byId.get(id);
    if (widget === undefined || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [widget];
  });
}

/** Stored ids, or an empty list when storage is blocked or the value is not a list of strings. */
export function readRecentIds(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // Recents are a convenience; a blocked or malformed value must not keep the palette from rendering.
    return [];
  }
}

export function writeRecentIds(ids: readonly string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // As with collapsed sections, storage is optional: recents still work for this visit.
  }
}
