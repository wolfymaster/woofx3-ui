import type { Doc } from "@convex/_generated/dataModel";
import { widgetSlotId } from "@/lib/dashboard-widgets/types";

export type DashboardPanel = NonNullable<Doc<"dashboardLayouts">["panels"]>[number];
export type DashboardPanelWidget = DashboardPanel["widgets"][number];

/**
 * How far from the selected panel a carousel slide still renders its widgets.
 * One neighbour each side, so a swipe never reveals an empty slide; anything
 * further out is unmounted, taking its subscriptions and polls with it.
 */
export const MOUNTED_PANEL_RADIUS = 1;

export function isPanelMounted(index: number, activeIndex: number): boolean {
  return Math.abs(index - activeIndex) <= MOUNTED_PANEL_RADIUS;
}

// Zones hold a stack of widgets. Adding or removing one re-splits the zone
// evenly; only an explicit drag (resizeZone) sets custom sizes after that.

export function assignWidget(
  widgets: DashboardPanelWidget[],
  zoneId: string,
  type: string,
  slotId: string
): DashboardPanelWidget[] {
  const otherWidgets = widgets.filter((widget) => widget.zoneId !== zoneId);
  const zoneWidgets = widgets.filter((widget) => widget.zoneId === zoneId);
  const evenSize = 100 / (zoneWidgets.length + 1);
  const resizedZoneWidgets = zoneWidgets.map((widget) => ({ ...widget, size: evenSize }));
  const newWidget: DashboardPanelWidget = { zoneId, slotId, type, size: evenSize };
  return [...otherWidgets, ...resizedZoneWidgets, newWidget];
}

export function removeWidget(widgets: DashboardPanelWidget[], zoneId: string, slotId: string): DashboardPanelWidget[] {
  const otherWidgets = widgets.filter((widget) => widget.zoneId !== zoneId);
  const remainingZoneWidgets = widgets.filter((widget) => widget.zoneId === zoneId && widgetSlotId(widget) !== slotId);
  const evenSize = remainingZoneWidgets.length > 0 ? 100 / remainingZoneWidgets.length : undefined;
  const resizedZoneWidgets = remainingZoneWidgets.map((widget) => ({ ...widget, size: evenSize }));
  return [...otherWidgets, ...resizedZoneWidgets];
}

export function configureWidget(
  widgets: DashboardPanelWidget[],
  zoneId: string,
  slotId: string,
  type: string,
  config: Record<string, unknown>
): DashboardPanelWidget[] {
  return widgets.map((widget) =>
    widget.zoneId === zoneId && widgetSlotId(widget) === slotId ? { ...widget, type, config } : widget
  );
}

/**
 * Applies `sizes` to a zone's widgets in order. Returns `widgets` itself when
 * every size already matches: the resizable group reports its layout on mount
 * too, and a fresh array there would re-render the panel for nothing.
 */
export function resizeZone(widgets: DashboardPanelWidget[], zoneId: string, sizes: number[]): DashboardPanelWidget[] {
  let index = 0;
  let changed = false;
  const next = widgets.map((widget) => {
    if (widget.zoneId !== zoneId) {
      return widget;
    }
    const size = sizes[index];
    index += 1;
    if (size == null || size === widget.size) {
      return widget;
    }
    changed = true;
    return { ...widget, size };
  });
  return changed ? next : widgets;
}

function evenlySplit(widgets: DashboardPanelWidget[]): DashboardPanelWidget[] {
  const evenSize = widgets.length > 0 ? 100 / widgets.length : undefined;
  return widgets.map((widget) => ({ ...widget, size: evenSize }));
}

/**
 * Moves one widget to `toIndex` within `toZoneId`'s stack, where `toIndex`
 * counts the destination's widgets without the one being moved. A reorder
 * within a zone keeps every widget's size, since they still add up to the
 * zone; a move between zones re-splits both zones evenly, as adding and
 * removing do. Returns `widgets` itself when the widget is already there.
 */
export function moveWidget(
  widgets: DashboardPanelWidget[],
  slotId: string,
  toZoneId: string,
  toIndex: number
): DashboardPanelWidget[] {
  const moving = widgets.find((widget) => widgetSlotId(widget) === slotId);
  if (!moving) {
    return widgets;
  }
  const fromZoneId = moving.zoneId;
  const rest = widgets.filter((widget) => widget !== moving);
  const destination = rest.filter((widget) => widget.zoneId === toZoneId);
  const index = Math.max(0, Math.min(toIndex, destination.length));

  if (fromZoneId === toZoneId) {
    const currentIndex = widgets.filter((widget) => widget.zoneId === toZoneId).indexOf(moving);
    if (currentIndex === index) {
      return widgets;
    }
    const reordered = [...destination.slice(0, index), moving, ...destination.slice(index)];
    return [...rest.filter((widget) => widget.zoneId !== toZoneId), ...reordered];
  }

  const source = evenlySplit(rest.filter((widget) => widget.zoneId === fromZoneId));
  const placed = { ...moving, zoneId: toZoneId };
  const target = evenlySplit([...destination.slice(0, index), placed, ...destination.slice(index)]);
  const untouched = rest.filter((widget) => widget.zoneId !== fromZoneId && widget.zoneId !== toZoneId);
  return [...untouched, ...source, ...target];
}
