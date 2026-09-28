import { describe, expect, test } from "bun:test";
import {
  assignWidget,
  configureWidget,
  type DashboardPanelWidget,
  isPanelMounted,
  removeWidget,
  resizeZone,
} from "./dashboard-panels";

const chat: DashboardPanelWidget = { zoneId: "0-0", slotId: "a", type: "chat", size: 100 };
const macros: DashboardPanelWidget = { zoneId: "0-1", slotId: "b", type: "macros" };

describe("isPanelMounted", () => {
  test("mounts the active panel and one neighbour each side", () => {
    expect([0, 1, 2, 3, 4].map((index) => isPanelMounted(index, 2))).toEqual([false, true, true, true, false]);
  });

  test("the first panel mounts only itself and the next", () => {
    expect([0, 1, 2].map((index) => isPanelMounted(index, 0))).toEqual([true, true, false]);
  });
});

describe("assignWidget", () => {
  test("stacks into the zone and re-splits it evenly", () => {
    const next = assignWidget([chat, macros], "0-0", "queue", "c");
    expect(next.filter((w) => w.zoneId === "0-0").map((w) => [w.slotId, w.size])).toEqual([
      ["a", 50],
      ["c", 50],
    ]);
    expect(next).toContain(macros);
  });
});

describe("removeWidget", () => {
  test("removes by slot and re-splits what remains", () => {
    const stacked = assignWidget([chat], "0-0", "queue", "c");
    expect(removeWidget(stacked, "0-0", "a")).toEqual([{ zoneId: "0-0", slotId: "c", type: "queue", size: 100 }]);
  });

  test("an emptied zone leaves no size behind", () => {
    expect(removeWidget([chat, macros], "0-0", "a")).toEqual([macros]);
  });
});

describe("configureWidget", () => {
  test("updates only the addressed slot", () => {
    const next = configureWidget([chat, macros], "0-1", "b", "macros", { buttons: 3 });
    expect(next[0]).toBe(chat);
    expect(next[1]).toEqual({ ...macros, config: { buttons: 3 } });
  });
});

describe("resizeZone", () => {
  test("applies sizes to the zone's widgets in order", () => {
    const stacked = assignWidget([chat, macros], "0-0", "queue", "c");
    const next = resizeZone(stacked, "0-0", [30, 70]);
    expect(next.filter((w) => w.zoneId === "0-0").map((w) => w.size)).toEqual([30, 70]);
  });

  test("returns the same array when nothing changes", () => {
    const widgets = [chat, macros];
    expect(resizeZone(widgets, "0-0", [100])).toBe(widgets);
  });
});
