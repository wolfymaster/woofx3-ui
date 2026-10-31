// The dashboard's layout: its panels, each a layout of zones holding widgets,
// and the rail of widgets docked beside them. Whichever store keeps a
// layout (Convex per user and instance, or the engine's local UI settings),
// it is edited with these operations, so both refuse and name things alike.

/** One widget placed in a panel's zone. */
export interface DashboardPanelWidget {
  /** The zone it sits in, `${row}-${column}` of its panel's layout. */
  zoneId: string;
  /**
   * Its identity within the zone. Absent on widgets saved when a zone held
   * one widget; `widgetSlotId` falls back to the zone id for those.
   */
  slotId?: string;
  /** The widget catalog's key for it. */
  type: string;
  config?: Record<string, unknown>;
  /** Percent (0-100) of its zone's stack. Absent means split evenly. */
  size?: number;
}

export interface DashboardPanel {
  id: string;
  name: string;
  /** A layout from the dashboard's layout catalog. */
  layoutId: string;
  widgets: DashboardPanelWidget[];
}

/** One widget docked to the rail. */
export interface DashboardRailWidget {
  slotId: string;
  type: string;
  config?: Record<string, unknown>;
}

/** The rail is a column of icon buttons, not a list; more widgets than this are refused. */
export const MAX_RAIL_WIDGETS = 12;

/** `panels` with a new, empty panel at the end, named after its position unless `name` is given. */
export function addPanel(panels: DashboardPanel[], id: string, layoutId: string, name?: string): DashboardPanel[] {
  if (panels.some((panel) => panel.id === id)) {
    throw new Error(`A panel with id ${id} already exists`);
  }
  return [...panels, { id, name: name ?? `Panel ${panels.length + 1}`, layoutId, widgets: [] }];
}

/** `panels` without `panelId`; removing a panel that is not there changes nothing. */
export function removePanel(panels: DashboardPanel[], panelId: string): DashboardPanel[] {
  return panels.filter((panel) => panel.id !== panelId);
}

function replacePanel(
  panels: DashboardPanel[],
  panelId: string,
  edit: (panel: DashboardPanel) => DashboardPanel
): DashboardPanel[] {
  const index = panels.findIndex((panel) => panel.id === panelId);
  if (index === -1) {
    throw new Error("Panel not found");
  }
  const next = [...panels];
  next[index] = edit(panels[index]);
  return next;
}

/** Renames `panelId` to `name`, trimmed. Refuses an empty name and a panel that is not there. */
export function renamePanel(panels: DashboardPanel[], panelId: string, name: string): DashboardPanel[] {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Name cannot be empty");
  }
  return replacePanel(panels, panelId, (panel) => ({ ...panel, name: trimmed }));
}

/** Replaces `panelId`'s widgets in one go. Refuses a panel that is not there. */
export function setPanelWidgets(
  panels: DashboardPanel[],
  panelId: string,
  widgets: DashboardPanelWidget[]
): DashboardPanel[] {
  return replacePanel(panels, panelId, (panel) => ({ ...panel, widgets }));
}

/** Throws unless `widgets` fits the rail and names each slot once. */
export function assertRailWidgets(widgets: DashboardRailWidget[]): void {
  if (widgets.length > MAX_RAIL_WIDGETS) {
    throw new Error(`The rail holds at most ${MAX_RAIL_WIDGETS} widgets`);
  }
  const slotIds = new Set(widgets.map((widget) => widget.slotId));
  if (slotIds.size !== widgets.length) {
    throw new Error("Rail widgets must have distinct slot ids");
  }
}
