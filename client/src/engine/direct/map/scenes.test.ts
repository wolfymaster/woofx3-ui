import { describe, expect, test } from "bun:test";
import type { SceneSnapshot } from "@woofx3/api";
import type { AvailableWidget } from "./scenes";
import { toSceneRecord, toSceneWidgetCatalogRow } from "./scenes";

const snapshot: SceneSnapshot = {
  id: "s-1",
  kind: "scene",
  name: "Main",
  description: "",
  widgetsJson: '[{"widgetCanonicalId":"woofx3:widget:text"}]',
  layoutJson: '{"width":1280,"height":720,"backgroundColor":"#000"}',
  behaviorsJson: "{}",
  inputsJson: "[]",
  createdByType: "USER",
  createdByRef: "",
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T11:00:00Z",
};

describe("toSceneRecord", () => {
  test("takes its size and background from the layout", () => {
    expect(toSceneRecord(snapshot)).toEqual({
      id: "s-1",
      engineSceneId: "s-1",
      name: "Main",
      description: undefined,
      widgets: [{ widgetCanonicalId: "woofx3:widget:text" }],
      width: 1280,
      height: 720,
      backgroundColor: "#000",
      createdAt: Date.parse("2026-10-28T10:00:00Z"),
      updatedAt: Date.parse("2026-10-28T11:00:00Z"),
    });
  });

  test.each([
    ["an empty layout", "{}"],
    ["a layout that is not JSON", "{"],
    ["a layout that is not an object", "[]"],
  ])("%s gets the default canvas", (_case, layoutJson) => {
    expect(toSceneRecord({ ...snapshot, layoutJson })).toMatchObject({
      width: 1920,
      height: 1080,
      backgroundColor: "transparent",
    });
  });

  test("unreadable widgets read as none", () => {
    expect(toSceneRecord({ ...snapshot, widgetsJson: "not json" }).widgets).toEqual([]);
  });

  test("a time that does not parse is refused", () => {
    expect(() => toSceneRecord({ ...snapshot, updatedAt: "yesterday" })).toThrow("not a time");
  });
});

describe("toSceneWidgetCatalogRow", () => {
  const widget: AvailableWidget = {
    id: "w-1",
    manifestId: "now_playing",
    name: "Now playing",
    description: "",
    directory: "now_playing",
    alertTypes: [],
    settingsSchema: '[{"id":"size","label":"Size","type":"number"}]',
    surfaces: ["scene"],
    hostsSurface: "",
    taxonomy: [],
    behaviorKinds: { transitions: [{ id: "fade", label: "" }], effects: [] },
    createdByType: "MODULE",
    createdByRef: "spotify:1.0.0:abc1234",
  };
  const names = new Map([["spotify", "Spotify"]]);

  test("a module's widget is keyed and grouped by the module's manifest id, whatever its version", () => {
    const row = toSceneWidgetCatalogRow(widget, names, "Built-in");
    expect(row).toMatchObject({
      widgetId: "spotify:widget:now_playing",
      moduleId: "spotify",
      moduleName: "Spotify",
      description: undefined,
      hostsSurface: undefined,
      behaviorKinds: { transitions: [{ id: "fade", label: "fade" }], effects: [] },
    });
    expect(row.settings).toHaveLength(1);
  });

  test("an engine widget belongs to no module", () => {
    const row = toSceneWidgetCatalogRow(
      { ...widget, createdByType: "SYSTEM", createdByRef: "woofx3" },
      names,
      "Built-in"
    );
    expect([row.moduleId, row.moduleName]).toEqual([undefined, "Built-in"]);
  });

  test("a module the engine no longer lists groups under its id", () => {
    const row = toSceneWidgetCatalogRow(widget, new Map(), "Built-in");
    expect([row.moduleId, row.moduleName]).toEqual(["spotify", "spotify"]);
  });
});
