import { describe, expect, test } from "bun:test";
import { parseSceneLayout, parseSceneWidgets } from "./sceneSerialization";

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
