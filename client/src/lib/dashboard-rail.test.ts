import { describe, expect, test } from "bun:test";
import {
  addRailWidget,
  configureRailWidget,
  type DashboardRailWidget,
  DEFAULT_RAIL_WIDGETS,
  MAX_RAIL_WIDGETS,
  moveRailWidget,
  removeRailWidget,
  resolveRailWidgets,
} from "./dashboard-rail";

const notes: DashboardRailWidget = { slotId: "a", type: "notes" };
const stats: DashboardRailWidget = { slotId: "b", type: "stream-stats" };
const timer: DashboardRailWidget = { slotId: "c", type: "timer" };

describe("resolveRailWidgets", () => {
  test("an unedited rail shows the defaults", () => {
    expect(resolveRailWidgets(null)).toBe(DEFAULT_RAIL_WIDGETS);
    expect(resolveRailWidgets(undefined)).toBe(DEFAULT_RAIL_WIDGETS);
  });

  test("an emptied rail stays empty", () => {
    expect(resolveRailWidgets([])).toEqual([]);
  });
});

describe("addRailWidget", () => {
  test("appends to the end", () => {
    expect(addRailWidget([notes], "timer", "c")).toEqual([notes, { slotId: "c", type: "timer" }]);
  });

  test("refuses past the limit", () => {
    const full = Array.from({ length: MAX_RAIL_WIDGETS }, (_, i) => ({ slotId: String(i), type: "notes" }));
    expect(addRailWidget(full, "timer", "x")).toBe(full);
  });
});

describe("removeRailWidget", () => {
  test("removes by slot", () => {
    expect(removeRailWidget([notes, stats], "a")).toEqual([stats]);
  });
});

describe("moveRailWidget", () => {
  test("moves a widget to a new index", () => {
    expect(moveRailWidget([notes, stats, timer], "c", 0)).toEqual([timer, notes, stats]);
    expect(moveRailWidget([notes, stats, timer], "a", 2)).toEqual([stats, timer, notes]);
  });

  test("returns the same array when nothing moves", () => {
    const widgets = [notes, stats];
    expect(moveRailWidget(widgets, "a", 0)).toBe(widgets);
    expect(moveRailWidget(widgets, "missing", 1)).toBe(widgets);
  });
});

describe("configureRailWidget", () => {
  test("updates only the addressed slot", () => {
    const next = configureRailWidget([notes, stats], "b", { compact: true });
    expect(next[0]).toBe(notes);
    expect(next[1]).toEqual({ ...stats, config: { compact: true } });
  });
});
