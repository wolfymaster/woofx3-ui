// Predefined dashboard canvas layouts. Each layout is a stack of rows, and
// each row is split into an equal number of columns. Picking one from
// DashboardLayoutPicker persists its `id` via dashboardLayouts.setCanvasLayout.

export interface DashboardLayoutRow {
  columns: number;
}

export interface DashboardLayoutDefinition {
  id: string;
  name: string;
  rows: DashboardLayoutRow[];
}

export const dashboardLayouts: DashboardLayoutDefinition[] = [
  {
    id: "row-then-three-columns",
    name: "Top Row + 3 Columns",
    rows: [{ columns: 1 }, { columns: 3 }],
  },
];

export function getDashboardLayout(layoutId: string): DashboardLayoutDefinition | undefined {
  return dashboardLayouts.find((layout) => layout.id === layoutId);
}
