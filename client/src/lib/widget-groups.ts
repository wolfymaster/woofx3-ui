/**
 * The sections of a widget palette, ordered as shown.
 *
 * Grouping is by what a widget's content is, not how it renders or which module
 * shipped it: a Counter and a Database value both draw numbers, but belong
 * together because both read live values, while Text sits with the things whose
 * content the streamer sets directly. Module authors declare this through the
 * first segment of `taxonomy`; a widget from any module declaring `data.*` lands
 * in Data & sources.
 */
export const WIDGET_SECTION_KEYS = ["content", "data", "overlays", "other"] as const;
export type WidgetSectionKey = (typeof WIDGET_SECTION_KEYS)[number];

export interface WidgetSection<T> {
  key: WidgetSectionKey;
  label: string;
  widgets: T[];
}

const SECTION_LABEL: Record<WidgetSectionKey, string> = {
  content: "Content",
  data: "Data & sources",
  overlays: "Overlays",
  other: "Other",
};

/** The taxonomy families that make each section. Anything undeclared is Other. */
const FAMILY_SECTION: Record<string, WidgetSectionKey> = {
  alert: "content",
  text: "content",
  media: "content",
  data: "data",
  overlay: "overlays",
};

/** The section a widget belongs to, from its first taxonomy segment. */
export function widgetSectionKey(widget: { taxonomy?: string[] }): WidgetSectionKey {
  const first = widget.taxonomy?.find((entry) => entry.trim() !== "");
  const family = first?.split(".")[0]?.trim().toLowerCase();
  return (family === undefined ? undefined : FAMILY_SECTION[family]) ?? "other";
}

/** Widgets in section order, each section's widgets ordered by name; empty sections drop out. */
export function groupWidgetsIntoSections<T extends { name: string; taxonomy?: string[] }>(
  widgets: readonly T[]
): WidgetSection<T>[] {
  const byKey = new Map<WidgetSectionKey, T[]>();
  for (const widget of widgets) {
    const key = widgetSectionKey(widget);
    const existing = byKey.get(key);
    if (existing) {
      existing.push(widget);
    } else {
      byKey.set(key, [widget]);
    }
  }

  return WIDGET_SECTION_KEYS.flatMap((key) => {
    const members = byKey.get(key);
    if (members === undefined) {
      return [];
    }
    return [
      {
        key,
        label: SECTION_LABEL[key],
        widgets: [...members].sort((a, b) => a.name.localeCompare(b.name)),
      },
    ];
  });
}
