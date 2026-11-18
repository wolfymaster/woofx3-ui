import { describe, expect, test } from "bun:test";
import { groupWidgetsIntoSections, widgetSectionKey } from "@/lib/widget-groups";

function widget(name: string, taxonomy?: string[]) {
  return { name, taxonomy };
}

describe("widgetSectionKey", () => {
  test("groups a taxonomy family into the section for what its content is", () => {
    expect(widgetSectionKey(widget("Video", ["media.video"]))).toBe("content");
    expect(widgetSectionKey(widget("Alert", ["alert"]))).toBe("content");
    expect(widgetSectionKey(widget("Text", ["text"]))).toBe("content");
    expect(widgetSectionKey(widget("Database value", ["data.database"]))).toBe("data");
    expect(widgetSectionKey(widget("Wheel Spin", ["overlay.wheel"]))).toBe("overlays");
  });

  test("falls back to Other for a widget that declares nothing usable", () => {
    expect(widgetSectionKey(widget("Old"))).toBe("other");
    expect(widgetSectionKey(widget("Old", []))).toBe("other");
    expect(widgetSectionKey(widget("Old", ["  "]))).toBe("other");
    expect(widgetSectionKey(widget("Old", ["custom.thing"]))).toBe("other");
  });
});

describe("groupWidgetsIntoSections", () => {
  test("collapses content families into one Content section", () => {
    const groups = groupWidgetsIntoSections([
      widget("Video", ["media.video"]),
      widget("Alert", ["alert"]),
      widget("Image", ["media.image"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Content");
    expect(groups[0].widgets.map((w) => w.name)).toEqual(["Alert", "Image", "Video"]);
  });

  test("orders sections by purpose and sinks Other to the end", () => {
    const groups = groupWidgetsIntoSections([
      widget("Legacy"),
      widget("Wheel Spin", ["overlay.wheel"]),
      widget("Text", ["text"]),
      widget("Counter", ["data.counter"]),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Content", "Data & sources", "Overlays", "Other"]);
  });

  test("drops empty sections and groups widgets from different modules that share a family", () => {
    const groups = groupWidgetsIntoSections([
      widget("Bundled Counter", ["data.counter"]),
      widget("Third-party Total", ["data.database", "platform.twitch"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("data");
    expect(groups[0].widgets.map((w) => w.name)).toEqual(["Bundled Counter", "Third-party Total"]);
  });
});
