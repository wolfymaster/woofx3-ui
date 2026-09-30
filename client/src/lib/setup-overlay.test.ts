import { describe, expect, test } from "bun:test";
import { findAlertWidget, SETUP_OVERLAY_SIZE, setupOverlayWidgets } from "./setup-overlay";

const alert = {
  widgetId: "woofx3:widget:alert",
  name: "Alert",
  hostsSurface: "alert",
  settings: [{ id: "name", defaultValue: "" }, { id: "padding", defaultValue: 8 }, { id: "noDefault" }],
};
const text = { widgetId: "woofx3:widget:text", name: "Text", settings: [] };

describe("findAlertWidget", () => {
  test("finds the widget that hosts alerts", () => {
    expect(findAlertWidget([text, alert])).toBe(alert);
    expect(findAlertWidget([text])).toBeUndefined();
  });
});

describe("setupOverlayWidgets", () => {
  test("places the alert widget over the whole canvas with the default name", () => {
    const [widget] = setupOverlayWidgets(alert);
    expect(widget.widgetCanonicalId).toBe("woofx3:widget:alert");
    expect(widget.position).toEqual({ x: 0, y: 0 });
    expect(widget.size).toEqual(SETUP_OVERLAY_SIZE);
    expect(widget.settings).toEqual({ name: "default", padding: 8 });
  });

  test("starts empty without an alert widget", () => {
    expect(setupOverlayWidgets(undefined)).toEqual([]);
  });
});
