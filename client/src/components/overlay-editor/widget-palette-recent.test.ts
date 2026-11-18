import { describe, expect, test } from "bun:test";
import { pushRecentWidget, RECENT_WIDGET_LIMIT, recentWidgetsOf } from "./widget-palette-recent";

describe("pushRecentWidget", () => {
  test("puts the added widget first without repeating it", () => {
    expect(pushRecentWidget(["text", "counter"], "text")).toEqual(["text", "counter"]);
    expect(pushRecentWidget(["text", "counter"], "timer")).toEqual(["timer", "text", "counter"]);
  });

  test("stays bounded so the Recent section cannot take over the rail", () => {
    const ids = Array.from({ length: RECENT_WIDGET_LIMIT + 3 }, (_, index) => `widget-${index}`);
    const next = pushRecentWidget(ids, "newest");
    expect(next).toHaveLength(RECENT_WIDGET_LIMIT);
    expect(next[0]).toBe("newest");
    expect(next).not.toContain(`widget-${RECENT_WIDGET_LIMIT}`);
  });
});

describe("recentWidgetsOf", () => {
  const widgets = [
    { widgetId: "text", name: "Text" },
    { widgetId: "counter", name: "Counter" },
  ];

  test("returns installed widgets in recency order", () => {
    expect(recentWidgetsOf(["counter", "text"], widgets).map((widget) => widget.name)).toEqual(["Counter", "Text"]);
  });

  test("drops ids that are no longer installed and ignores repeats", () => {
    expect(recentWidgetsOf(["gone", "text", "counter", "text"], widgets).map((widget) => widget.widgetId)).toEqual([
      "text",
      "counter",
    ]);
  });
});
