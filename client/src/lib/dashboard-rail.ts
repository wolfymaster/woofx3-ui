import type { Doc } from "@convex/_generated/dataModel";

export type DashboardRailWidget = NonNullable<Doc<"dashboardLayouts">["railWidgets"]>[number];

/** Must match MAX_RAIL_WIDGETS in convex/dashboardLayouts.ts. */
export const MAX_RAIL_WIDGETS = 12;

/**
 * The rail a user has before they first edit it. The slot ids are fixed so a
 * user who never edits the rail keeps the same identities across loads.
 */
export const DEFAULT_RAIL_WIDGETS: DashboardRailWidget[] = [
  { slotId: "notes", type: "notes" },
  { slotId: "stream-stats", type: "stream-stats" },
];

/** `saved` is null until the user first edits the rail. */
export function resolveRailWidgets(saved: DashboardRailWidget[] | null | undefined): DashboardRailWidget[] {
  return saved ?? DEFAULT_RAIL_WIDGETS;
}

export function addRailWidget(widgets: DashboardRailWidget[], type: string, slotId: string): DashboardRailWidget[] {
  if (widgets.length >= MAX_RAIL_WIDGETS) {
    return widgets;
  }
  return [...widgets, { slotId, type }];
}

export function removeRailWidget(widgets: DashboardRailWidget[], slotId: string): DashboardRailWidget[] {
  return widgets.filter((widget) => widget.slotId !== slotId);
}

/** Moves one rail widget to `toIndex`. Returns `widgets` itself when nothing moves. */
export function moveRailWidget(widgets: DashboardRailWidget[], slotId: string, toIndex: number): DashboardRailWidget[] {
  const fromIndex = widgets.findIndex((widget) => widget.slotId === slotId);
  const index = Math.max(0, Math.min(toIndex, widgets.length - 1));
  if (fromIndex === -1 || fromIndex === index) {
    return widgets;
  }
  const next = [...widgets];
  const [moving] = next.splice(fromIndex, 1);
  next.splice(index, 0, moving);
  return next;
}

export function configureRailWidget(
  widgets: DashboardRailWidget[],
  slotId: string,
  config: Record<string, unknown>
): DashboardRailWidget[] {
  return widgets.map((widget) => (widget.slotId === slotId ? { ...widget, config } : widget));
}
