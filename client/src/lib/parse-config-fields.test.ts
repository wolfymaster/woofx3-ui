import { describe, expect, test } from "bun:test";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { sentenceParts } from "./condition-sentence";
import { parseConfigField, parseConfigFields, withWidgetCanonicalId } from "./parse-config-fields";
import { ANY_CONDITION } from "./workflow-presets-json";

describe("parseConfigFields", () => {
  test("parses internal source and eventPath metadata", () => {
    const fields = parseConfigFields([
      {
        id: "rewardId",
        label: "Reward",
        type: "select",
        source: {
          kind: "internal",
          request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
          timeoutMs: 10000,
        },
        eventPath: "rewardId",
        operator: "eq",
        description: "Only fire when the redemption matches this reward.",
        hint: "Loaded from Twitch.",
        examplePayload: '{"rewardId":"..."}',
      },
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0].source).toEqual({
      kind: "internal",
      request: { event: "twitchapi", payload: { command: "listChannelPointRewards" } },
      timeoutMs: 10000,
    });
    expect(fields[0].eventPath).toBe("rewardId");
    expect(fields[0].operator).toBe("eq");
    expect(fields[0].description).toBe("Only fire when the redemption matches this reward.");
  });

  test("keeps the app-state sources the custom renderers are keyed on", () => {
    const fields = parseConfigFields([
      { id: "target", label: "Alert widget", type: "text", source: { kind: "alertWidgets" } },
      { id: "scene", label: "Scene", type: "text", source: { kind: "scenes" } },
      { id: "widget", label: "Widget", type: "text", source: { kind: "scenePlacements", sceneField: "scene" } },
    ]);
    expect(fields.map((f) => f.source)).toEqual([
      { kind: "alertWidgets" },
      { kind: "scenes" },
      { kind: "scenePlacements", sceneField: "scene" },
    ]);
  });

  test("drops a scenePlacements source that names no scene field", () => {
    const [field] = parseConfigFields([
      { id: "widget", label: "Widget", type: "text", source: { kind: "scenePlacements" } },
    ]);
    expect(field.source).toBeUndefined();
  });

  // The contract's type list is closed and barkloader validates it at install, so an
  // unrecognised type means a malformed declaration rather than a dialect to translate.
  // `boolean` was the one the old parser rewrote to `toggle`; no manifest declares it.
  test("drops a field whose type is not in the contract", () => {
    expect(parseConfigFields([{ id: "x", label: "X", type: "boolean" }])).toEqual([]);
  });

  test("maps resource_ref field's resourceKind property (actual engine wire shape)", () => {
    const [f] = parseConfigFields([{ id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" }]);
    expect(f.type).toBe("resource_ref");
    expect(f.resourceKind).toBe("counter");
  });

  test("parseConfigField drops unknown types", () => {
    expect(parseConfigField({ id: "x", label: "X", type: "unknown" })).toBeNull();
  });
});

// The bundled woofx3 module's Alert and Set widget visibility schemas, as its
// manifest declares them. Inlined because CI checks out only the engine's
// shared packages, not its modules.
const ALERT_SCHEMA = [
  { id: "target", label: "Alert widget", type: "text", source: { kind: "alertWidgets" }, defaultValue: "default" },
  { id: "layout", label: "Alert", type: "layout", surface: "alert", required: true },
];
const WIDGET_VISIBILITY_SCHEMA = [
  { id: "sceneId", label: "Scene", type: "text", required: true, source: { kind: "scenes" } },
  {
    id: "placementId",
    label: "Widget",
    type: "text",
    required: true,
    source: { kind: "scenePlacements", sceneField: "sceneId" },
  },
  { id: "visible", label: "Visible", type: "toggle", defaultValue: true },
];

describe("bundled woofx3 module fields", () => {
  test("the Alert action keeps its alert widget source and layout surface", () => {
    const [target, layout] = parseConfigFields(ALERT_SCHEMA);
    expect(target.source).toEqual({ kind: "alertWidgets" });
    expect(layout.type).toBe("layout");
    expect(layout.surface).toBe("alert");
  });

  test("Set widget visibility keeps its scene and placement sources", () => {
    const [scene, placement] = parseConfigFields(WIDGET_VISIBILITY_SCHEMA);
    expect(scene.source).toEqual({ kind: "scenes" });
    expect(placement.source).toEqual({ kind: "scenePlacements", sceneField: "sceneId" });
  });
});

describe("surface", () => {
  test("keeps a known surface on a layout field", () => {
    const [field] = parseConfigFields([{ id: "layout", label: "Alert", type: "layout", surface: "scene" }]);
    expect(field.surface).toBe("scene");
  });

  test("drops an unknown surface, and one on a field that is not a layout", () => {
    const [unknown, notLayout] = parseConfigFields([
      { id: "layout", label: "Alert", type: "layout", surface: "dock" },
      { id: "name", label: "Name", type: "text", surface: "alert" },
    ]);
    expect(unknown.surface).toBeUndefined();
    expect(notLayout.surface).toBeUndefined();
  });
});

describe("button action", () => {
  test("keeps an internal request", () => {
    const [field] = parseConfigFields([
      {
        id: "test",
        label: "Test connection",
        type: "button",
        action: { kind: "internal", request: { event: "obs.ping", payload: { a: 1 } }, timeoutMs: 5000 },
      },
    ]);
    expect(field.action).toEqual({
      kind: "internal",
      request: { event: "obs.ping", payload: { a: 1 } },
      timeoutMs: 5000,
    });
  });

  test("keeps an integration", () => {
    const [field] = parseConfigFields([
      { id: "connect", label: "Connect", type: "button", action: { kind: "integration", integration: "spotify" } },
    ]);
    expect(field.action).toEqual({ kind: "integration", integration: "spotify" });
  });

  test("drops a malformed action, and one on a field that is not a button", () => {
    const fields = parseConfigFields([
      { id: "a", label: "A", type: "button", action: { kind: "internal", request: {} } },
      { id: "b", label: "B", type: "button", action: { kind: "integration" } },
      { id: "c", label: "C", type: "button", action: { kind: "webhook", url: "https://example.com" } },
      { id: "d", label: "D", type: "text", action: { kind: "integration", integration: "spotify" } },
    ]);
    expect(fields.map((field) => field.action)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("sentence wording", () => {
  test("keeps anyText, including the empty string that drops the part", () => {
    const [segment, anon] = parseConfigFields([
      { id: "segmentId", label: "Segment", type: "text", anyText: "any segment" },
      { id: "anon", label: "Anonymous", type: "toggle", anyText: "" },
    ]);
    expect(segment.anyText).toBe("any segment");
    expect(anon.anyText).toBe("");
  });

  test("keeps a non-empty missingText", () => {
    const [field] = parseConfigFields([
      { id: "reward", label: "Reward", type: "select", required: true, missingText: "a reward to pick" },
    ]);
    expect(field.missingText).toBe("a reward to pick");
  });

  test("drops whitespace-only and non-string wording", () => {
    const fields = parseConfigFields([
      { id: "a", label: "A", type: "text", anyText: "  ", missingText: "" },
      { id: "b", label: "B", type: "text", anyText: null, missingText: 3 },
    ]);
    expect(fields.map((field) => [field.anyText, field.missingText])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  test("a parsed field's wording reaches the trigger sentence", () => {
    const fields = parseConfigFields([
      { id: "segmentId", label: "Segment", type: "text", anyText: "any segment" },
      { id: "reward", label: "Reward", type: "select", required: true, missingText: "a reward to pick" },
    ]);
    const parts = sentenceParts("Someone in {segmentId} redeems {reward}", fields, { segmentId: ANY_CONDITION });
    const texts = parts.filter((part) => part.kind === "field").map((part) => part.text);
    expect(texts).toEqual(["any segment", "a reward to pick"]);
  });
});

describe("list fields", () => {
  test("parses a list with the fields of its rows", () => {
    const [field] = parseConfigFields([
      {
        id: "goals",
        label: "Goals",
        type: "list",
        itemFields: [
          { id: "value", label: "Goal", type: "number", required: true },
          { id: "name", label: "Name", type: "text" },
        ],
      },
    ]);
    expect(field.type).toBe("list");
    expect(field.itemFields?.map((item) => [item.id, item.type, item.required])).toEqual([
      ["value", "number", true],
      ["name", "text", false],
    ]);
  });

  test("drops row fields a row cannot hold, and a list left with none", () => {
    const fields = parseConfigFields([
      {
        id: "goals",
        label: "Goals",
        type: "list",
        itemFields: [
          { id: "value", label: "Goal", type: "number" },
          { id: "counter", label: "Counter", type: "resource_ref", resourceKind: "counter" },
        ],
      },
      { id: "empty", label: "Empty", type: "list", itemFields: [] },
      { id: "missing", label: "Missing", type: "list" },
    ]);
    expect(fields.map((field) => field.id)).toEqual(["goals"]);
    expect(fields[0].itemFields?.map((item) => item.id)).toEqual(["value"]);
  });
});

describe("withWidgetCanonicalId", () => {
  test("attaches the widget to a theme field only", () => {
    // `theme` is cast because the SDK's field type union gains it only with engine widget themes.
    const themeField = { id: "theme", label: "Theme", type: "theme" } as unknown as ConfigField;
    const colorField: ConfigField = { id: "color", label: "Color", type: "color" };
    const [theme, color] = withWidgetCanonicalId([themeField, colorField], "timer:widget:clock");
    expect((theme as { widgetCanonicalId?: string }).widgetCanonicalId).toBe("timer:widget:clock");
    expect(color).toBe(colorField);
  });
});
