import { describe, expect, test } from "bun:test";
import { getWidgetDefinition, getDefaultLayout, WIDGET_REGISTRY } from "./registry";

describe("Widget Registry", () => {
  test("contains expected widget types", () => {
    const types = WIDGET_REGISTRY.map((w) => w.type);
    expect(types).toContain("stream-status");
    expect(types).toContain("recent-events");
    expect(types).toContain("quick-actions");
    expect(types).toContain("alert-queue");
  });

  test("getWidgetDefinition returns correct widget", () => {
    const widget = getWidgetDefinition("stream-status");
    expect(widget).toBeDefined();
    expect(widget?.name).toBe("Stream Status");
    expect(widget?.category).toBe("stream");
  });

  test("getWidgetDefinition returns undefined for unknown type", () => {
    const widget = getWidgetDefinition("unknown");
    expect(widget).toBeUndefined();
  });

  test("getDefaultLayout returns array of widgets", () => {
    const layout = getDefaultLayout();
    expect(layout.length).toBeGreaterThan(0);
    expect(layout[0].type).toBe("stream-status");
  });

  test("all widgets have required fields", () => {
    for (const widget of WIDGET_REGISTRY) {
      expect(widget.type).toBeTruthy();
      expect(widget.name).toBeTruthy();
      expect(widget.description).toBeTruthy();
      expect(widget.icon).toBeTruthy();
      expect(widget.category).toBeTruthy();
      expect(widget.defaultSize.width).toBeGreaterThan(0);
      expect(widget.defaultSize.height).toBeGreaterThan(0);
    }
  });
});
