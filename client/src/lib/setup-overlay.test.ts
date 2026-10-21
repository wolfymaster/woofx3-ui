import { describe, expect, test } from "bun:test";
import {
  findAlertWidget,
  type OverlaySyncRun,
  overlayCatalogState,
  SETUP_OVERLAY_SIZE,
  setupOverlayWidgets,
} from "./setup-overlay";

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

describe("overlayCatalogState", () => {
  const run = (id: string, status: OverlaySyncRun["status"], widgets: string): OverlaySyncRun => ({
    id,
    status,
    steps: [
      { name: "modules", status: "success" },
      { name: "widgets", status: widgets },
    ],
  });

  test("is ready as soon as the alert widget is in the catalog", () => {
    expect(overlayCatalogState(true, [])).toBe("ready");
    expect(overlayCatalogState(true, [run("a", "running", "pending")], null)).toBe("ready");
  });

  test("does not take an empty catalog at its word before a sync has read the widgets", () => {
    expect(overlayCatalogState(false, [])).toBe("unsynced");
    expect(overlayCatalogState(false, [run("a", "running", "pending")])).toBe("syncing");
    expect(overlayCatalogState(false, [run("a", "error", "error")])).toBe("failed");
  });

  test("is ready without an alert widget once a sync read the engine's widgets", () => {
    expect(overlayCatalogState(false, [run("b", "error", "success"), run("a", "error", "error")])).toBe("ready");
  });

  test("waits for the run it asked for rather than the one before", () => {
    expect(overlayCatalogState(false, [], null)).toBe("syncing");
    expect(overlayCatalogState(false, [run("a", "error", "error")], "a")).toBe("syncing");
    expect(overlayCatalogState(false, [run("b", "error", "error"), run("a", "error", "error")], "a")).toBe("failed");
  });
});
