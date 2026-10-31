import { describe, expect, test } from "bun:test";
import {
  addPanel,
  assertRailWidgets,
  type DashboardPanel,
  type DashboardRailWidget,
  MAX_RAIL_WIDGETS,
  removePanel,
  renamePanel,
  setPanelWidgets,
} from "./dashboard-layout";

const main: DashboardPanel = { id: "p1", name: "Main", layoutId: "single", widgets: [] };
const chat: DashboardPanel = {
  id: "p2",
  name: "Chat",
  layoutId: "quad",
  widgets: [{ zoneId: "0-0", slotId: "s1", type: "notes" }],
};

describe("addPanel", () => {
  const cases: Array<{ name: string; panels: DashboardPanel[]; given?: string; expected: string }> = [
    { name: "the first panel is Panel 1", panels: [], expected: "Panel 1" },
    { name: "a later panel is named after its position", panels: [main, chat], expected: "Panel 3" },
    { name: "a given name is kept", panels: [main], given: "Raid", expected: "Raid" },
  ];
  for (const { name, panels, given, expected } of cases) {
    test(name, () => {
      const next = addPanel(panels, "new", "quad", given);
      expect(next).toEqual([...panels, { id: "new", name: expected, layoutId: "quad", widgets: [] }]);
    });
  }

  test("refuses an id a panel already has", () => {
    expect(() => addPanel([main], "p1", "single")).toThrow("A panel with id p1 already exists");
  });
});

describe("removePanel", () => {
  const cases: Array<{ name: string; panelId: string; expected: DashboardPanel[] }> = [
    { name: "drops the panel", panelId: "p1", expected: [chat] },
    { name: "a panel that is not there changes nothing", panelId: "gone", expected: [main, chat] },
  ];
  for (const { name, panelId, expected } of cases) {
    test(name, () => {
      expect(removePanel([main, chat], panelId)).toEqual(expected);
    });
  }
});

describe("renamePanel", () => {
  const cases: Array<{ name: string; panelId: string; to: string; expected: DashboardPanel[] | string }> = [
    { name: "renames the panel, trimmed", panelId: "p2", to: "  Raids ", expected: [main, { ...chat, name: "Raids" }] },
    { name: "refuses an empty name", panelId: "p2", to: "", expected: "Name cannot be empty" },
    { name: "refuses a blank name", panelId: "p2", to: "   ", expected: "Name cannot be empty" },
    { name: "refuses a panel that is not there", panelId: "gone", to: "Raids", expected: "Panel not found" },
  ];
  for (const { name, panelId, to, expected } of cases) {
    test(name, () => {
      if (typeof expected === "string") {
        expect(() => renamePanel([main, chat], panelId, to)).toThrow(expected);
        return;
      }
      expect(renamePanel([main, chat], panelId, to)).toEqual(expected);
    });
  }
});

describe("setPanelWidgets", () => {
  const widgets = [{ zoneId: "0-1", slotId: "s2", type: "timer", size: 50, config: { timer: "t1" } }];

  test("replaces the panel's widgets and leaves the others alone", () => {
    expect(setPanelWidgets([main, chat], "p1", widgets)).toEqual([{ ...main, widgets }, chat]);
  });

  test("refuses a panel that is not there", () => {
    expect(() => setPanelWidgets([main, chat], "gone", widgets)).toThrow("Panel not found");
  });
});

describe("assertRailWidgets", () => {
  const widget = (slotId: string): DashboardRailWidget => ({ slotId, type: "notes" });
  const full = Array.from({ length: MAX_RAIL_WIDGETS }, (_, index) => widget(`s${index}`));
  const cases: Array<{ name: string; widgets: DashboardRailWidget[]; error: string | null }> = [
    { name: "an empty rail is fine", widgets: [], error: null },
    { name: "a full rail is fine", widgets: full, error: null },
    { name: "one more than fits is refused", widgets: [...full, widget("extra")], error: "at most 12 widgets" },
    { name: "a slot named twice is refused", widgets: [widget("a"), widget("a")], error: "distinct slot ids" },
  ];
  for (const { name, widgets, error } of cases) {
    test(name, () => {
      if (error === null) {
        expect(() => assertRailWidgets(widgets)).not.toThrow();
        return;
      }
      expect(() => assertRailWidgets(widgets)).toThrow(error);
    });
  }
});
