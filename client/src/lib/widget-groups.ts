import { taxonomyLabel } from "@/lib/alert-groups";

/** The group a widget with no declared taxonomy falls into. */
export const UNCLASSIFIED_KEY = "other";

export interface WidgetGroup<T> {
  /** First taxonomy segment, or UNCLASSIFIED_KEY. Stable across renames of the label. */
  key: string;
  label: string;
  widgets: T[];
}

/**
 * The widget catalog grouped for a picker: one section per taxonomy family.
 *
 * Grouping reads the widget's declared `taxonomy` rather than the module that
 * shipped it, so `media.video` from two different modules lands in one Media
 * section — the same reason the Alerts menu reads a trigger's declared axis
 * instead of parsing its event name (see lib/alert-groups.ts). Grouping by
 * module put every bundled widget under one heading, which is no grouping at all.
 *
 * Only the first segment of the first entry counts. Widgets are a flat picker,
 * not a tree: `media.image` and `media.audio` belong in one Media section, and
 * splitting to full depth would leave a heading per tile. A widget declaring
 * nothing goes to Other, which sorts last.
 */
export function groupWidgetsByTaxonomy<T extends { name: string; taxonomy?: string[] }>(
  widgets: readonly T[]
): WidgetGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const widget of widgets) {
    const key = widgetGroupKey(widget);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(widget);
    } else {
      byKey.set(key, [widget]);
    }
  }

  const groups = Array.from(byKey.entries(), ([key, group]) => ({
    key,
    label: key === UNCLASSIFIED_KEY ? "Other" : taxonomyLabel(key),
    widgets: [...group].sort((a, b) => a.name.localeCompare(b.name)),
  }));

  return groups.sort((a, b) => {
    const aOther = a.key === UNCLASSIFIED_KEY;
    const bOther = b.key === UNCLASSIFIED_KEY;
    if (aOther !== bOther) {
      return aOther ? 1 : -1;
    }
    return a.label.localeCompare(b.label);
  });
}

/** The section a widget belongs to: its first taxonomy segment, else UNCLASSIFIED_KEY. */
export function widgetGroupKey(widget: { taxonomy?: string[] }): string {
  const first = widget.taxonomy?.find((entry) => entry.trim() !== "");
  const segment = first?.split(".")[0]?.trim();
  return segment ? segment : UNCLASSIFIED_KEY;
}
