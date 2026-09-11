// Predefined dashboard canvas layouts. Each layout is a stack of rows, and
// each row is split into columns. Picking one from DashboardLayoutPicker
// persists its `id` via dashboardLayouts.addPanel.
//
// Zone ids are positional (`${rowIndex}-${columnIndex}`) and are what a placed
// widget stores, so never reorder or renumber the rows/columns of an existing
// layout — that silently moves every widget already placed on it. Adding a new
// layout is always safe.

export interface DashboardLayoutRow {
  columns: number;
  /** Share of the panel's height, relative to the other rows. Defaults to 1 (all rows equal). */
  weight?: number;
  /** Share of the row's width per column, relative to its siblings. Length must equal `columns`. */
  columnWeights?: number[];
}

export interface DashboardLayoutDefinition {
  id: string;
  name: string;
  rows: DashboardLayoutRow[];
}

export const dashboardLayouts: DashboardLayoutDefinition[] = [
  {
    id: "single",
    name: "Single",
    rows: [{ columns: 1 }],
  },
  {
    id: "two-columns",
    name: "Split",
    rows: [{ columns: 2 }],
  },
  {
    id: "three-columns",
    name: "Three-up",
    rows: [{ columns: 3 }],
  },
  {
    id: "quad",
    name: "Quad",
    rows: [{ columns: 2 }, { columns: 2 }],
  },
  {
    id: "row-then-three-columns",
    name: "Top Row + 3 Columns",
    rows: [
      { columns: 1, weight: 1 },
      { columns: 3, weight: 2 },
    ],
  },
  {
    // Narrow left dock (macro pad), wide center (activity), medium right
    // (broadcast controls) — the main content row of the redesign.
    id: "dock-activity-controls",
    name: "Dock + Activity + Controls",
    rows: [{ columns: 3, columnWeights: [1, 4, 2] }],
  },
];

export function getDashboardLayout(layoutId: string): DashboardLayoutDefinition | undefined {
  return dashboardLayouts.find((layout) => layout.id === layoutId);
}

/** Flex-grow for a row, and for a column within it — both default to an even split. */
export function rowWeight(row: DashboardLayoutRow): number {
  return row.weight ?? 1;
}

export function columnWeight(row: DashboardLayoutRow, columnIndex: number): number {
  return row.columnWeights?.[columnIndex] ?? 1;
}
