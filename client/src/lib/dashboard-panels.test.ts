import { describe, expect, test } from "bun:test";
import {
  assignWidget,
  configureWidget,
  type DashboardPanelWidget,
  isPanelMounted,
  moveWidget,
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

describe("moveWidget", () => {
  const queue: DashboardPanelWidget = { zoneId: "0-0", slotId: "c", type: "queue", size: 40 };
  const first: DashboardPanelWidget = { ...chat, size: 60 };

  test("reorders within a zone and keeps each widget's size", () => {
    const next = moveWidget([first, queue, macros], "c", "0-0", 0);
    expect(next.filter((w) => w.zoneId === "0-0").map((w) => [w.slotId, w.size])).toEqual([
      ["c", 40],
      ["a", 60],
    ]);
    expect(next).toContain(macros);
  });

  test("returns the same array when the widget is already in place", () => {
    const widgets = [first, queue, macros];
    expect(moveWidget(widgets, "a", "0-0", 0)).toBe(widgets);
  });

  test("moves between zones and re-splits both evenly", () => {
    const next = moveWidget([first, queue, macros], "a", "0-1", 1);
    expect(next.filter((w) => w.zoneId === "0-0").map((w) => [w.slotId, w.size])).toEqual([["c", 100]]);
    expect(next.filter((w) => w.zoneId === "0-1").map((w) => [w.slotId, w.size])).toEqual([
      ["b", 50],
      ["a", 50],
    ]);
  });

  test("can move into an empty zone", () => {
    const next = moveWidget([first, queue], "c", "1-0", 0);
    expect(next.find((w) => w.slotId === "c")).toEqual({ zoneId: "1-0", slotId: "c", type: "queue", size: 100 });
    expect(next.find((w) => w.slotId === "a")?.size).toBe(100);
  });

  test("clamps an index past the end of the zone", () => {
    const next = moveWidget([first, queue, macros], "b", "0-0", 9);
    expect(next.filter((w) => w.zoneId === "0-0").map((w) => w.slotId)).toEqual(["a", "c", "b"]);
  });
});
