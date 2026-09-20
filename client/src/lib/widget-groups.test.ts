import { describe, expect, test } from "bun:test";
import { groupWidgetsByTaxonomy, UNCLASSIFIED_KEY, widgetGroupKey } from "@/lib/widget-groups";

function widget(name: string, taxonomy?: string[]) {
  return { name, taxonomy };
}

describe("widgetGroupKey", () => {
  test("takes the first segment of the first declared entry", () => {
    expect(widgetGroupKey(widget("Video", ["media.video"]))).toBe("media");
    expect(widgetGroupKey(widget("Text", ["text"]))).toBe("text");
  });

  test("falls back to Other for a widget that declares nothing usable", () => {
    expect(widgetGroupKey(widget("Old"))).toBe(UNCLASSIFIED_KEY);
    expect(widgetGroupKey(widget("Old", []))).toBe(UNCLASSIFIED_KEY);
    expect(widgetGroupKey(widget("Old", ["  "]))).toBe(UNCLASSIFIED_KEY);
  });
});

describe("groupWidgetsByTaxonomy", () => {
  test("collapses a taxonomy family into one section", () => {
    const groups = groupWidgetsByTaxonomy([
      widget("Video", ["media.video"]),
      widget("Audio", ["media.audio"]),
      widget("Image", ["media.image"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Media");
    expect(groups[0].widgets.map((w) => w.name)).toEqual(["Audio", "Image", "Video"]);
  });

  test("orders sections by label and sinks Other to the end", () => {
    const groups = groupWidgetsByTaxonomy([
      widget("Legacy"),
      widget("Text", ["text"]),
      widget("Alert", ["alert"]),
      widget("Video", ["media.video"]),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Alert", "Media", "Text", "Other"]);
  });

  test("groups widgets from different modules that declare the same family together", () => {
    const groups = groupWidgetsByTaxonomy([
      widget("Bundled Video", ["media.video"]),
      widget("Third-party Clip", ["media.video", "platform.twitch"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].widgets.map((w) => w.name)).toEqual(["Bundled Video", "Third-party Clip"]);
  });
});
