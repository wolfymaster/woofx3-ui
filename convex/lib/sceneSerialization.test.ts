import { describe, expect, test } from "bun:test";
import {
  parseCompositionInputs,
  parseCompositionKind,
  parseSceneBehaviors,
  parseSceneLayout,
  parseSceneWidgets,
  tablesForDeletedComposition,
} from "./sceneSerialization";

describe("parseSceneWidgets", () => {
  test("parses a valid widgets array", () => {
    const widgets = parseSceneWidgets(JSON.stringify([{ id: "w1" }, { id: "w2" }]));
    expect(widgets).toHaveLength(2);
  });

  test("returns [] for empty string", () => {
    expect(parseSceneWidgets("")).toEqual([]);
  });

  test("returns [] for malformed JSON", () => {
    expect(parseSceneWidgets("{not json")).toEqual([]);
  });

  test("returns [] when JSON is not an array", () => {
    expect(parseSceneWidgets(JSON.stringify({ id: "w1" }))).toEqual([]);
  });

  test("round-trips widgets serialized by the editor", () => {
    const widgets = [{ id: "w-1", widgetCanonicalId: "builtin:widget:media_alert", settings: { volume: 50 } }];
    expect(parseSceneWidgets(JSON.stringify(widgets))).toEqual(widgets);
  });
});

describe("parseSceneLayout", () => {
  test("parses width/height/backgroundColor", () => {
    expect(parseSceneLayout(JSON.stringify({ width: 1280, height: 720, backgroundColor: "#000" }))).toEqual({
      width: 1280,
      height: 720,
      backgroundColor: "#000",
    });
  });

  test("returns {} for empty string", () => {
    expect(parseSceneLayout("")).toEqual({});
  });

  test("returns {} for malformed JSON", () => {
    expect(parseSceneLayout("nope")).toEqual({});
  });

  test("returns {} when JSON is an array", () => {
    expect(parseSceneLayout(JSON.stringify([1, 2, 3]))).toEqual({});
  });
});

describe("parseCompositionKind", () => {
  test("reads an alert", () => {
    expect(parseCompositionKind("alert")).toBe("alert");
  });

  test("reads a scene, and treats a missing or unknown kind as a scene", () => {
    expect(parseCompositionKind("scene")).toBe("scene");
    expect(parseCompositionKind(undefined)).toBe("scene");
    expect(parseCompositionKind("overlay")).toBe("scene");
  });
});

describe("tablesForDeletedComposition", () => {
  test("a deleted alert never touches the scenes cache", () => {
    expect(tablesForDeletedComposition("alert")).toEqual(["alertCompositions"]);
  });

  test("a deleted scene never touches the alert library", () => {
    expect(tablesForDeletedComposition("scene")).toEqual(["scenes"]);
  });

  test("without a kind both are looked in", () => {
    expect(tablesForDeletedComposition(undefined)).toEqual(["scenes", "alertCompositions"]);
  });
});

describe("parseSceneBehaviors", () => {
  test("parses an object keyed by behavior id", () => {
    const behaviors = { b1: { type: "transition", kind: "fade", target: "w1" } };
    expect(parseSceneBehaviors(JSON.stringify(behaviors))).toEqual(behaviors);
  });

  test("returns {} for missing, malformed or non-object JSON", () => {
    expect(parseSceneBehaviors(undefined)).toEqual({});
    expect(parseSceneBehaviors("")).toEqual({});
    expect(parseSceneBehaviors("{oops")).toEqual({});
    expect(parseSceneBehaviors("[1]")).toEqual({});
    expect(parseSceneBehaviors("null")).toEqual({});
  });
});

describe("parseCompositionInputs", () => {
  test("keeps input fields as the engine sent them", () => {
    const inputs = [
      { id: "name", label: "Name", type: "text", defaultValue: "someone" },
      { id: "sound", label: "Sound", type: "media", mediaType: "audio" },
    ];
    expect(parseCompositionInputs(JSON.stringify(inputs))).toEqual(inputs);
  });

  test("drops entries a step could not address", () => {
    const inputs = [
      { id: "a", type: "text" },
      "nope",
      null,
      [1],
      { label: "no id" },
      { id: "" },
      { id: "a", type: "number" },
    ];
    expect(parseCompositionInputs(JSON.stringify(inputs))).toEqual([{ id: "a", type: "text" }]);
  });

  test("returns [] for missing, malformed or non-array JSON", () => {
    expect(parseCompositionInputs(undefined)).toEqual([]);
    expect(parseCompositionInputs("{}")).toEqual([]);
    expect(parseCompositionInputs("[")).toEqual([]);
  });
});
