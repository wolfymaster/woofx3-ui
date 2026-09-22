import { describe, expect, test } from "bun:test";
import { flattenPayload, formatPayload, splitCloudEvent } from "./payload-fields";

describe("flattenPayload", () => {
  test("keys each leaf by the path that reaches it", () => {
    const { fields } = flattenPayload({ user: { login: "wolfy" }, bits: 100, items: [{ ok: true }] });
    expect(fields).toEqual([
      { path: "user.login", value: "wolfy", kind: "string" },
      { path: "bits", value: "100", kind: "number" },
      { path: "items[0].ok", value: "true", kind: "boolean" },
    ]);
  });

  test("quotes keys that are not identifiers", () => {
    const { fields } = flattenPayload({ "user-name": "x", nested: { "a b": 1 } });
    expect(fields.map((field) => field.path)).toEqual(['["user-name"]', 'nested["a b"]']);
  });

  // An empty container is still something the payload said.
  test("keeps empty containers and nulls as rows", () => {
    const { fields } = flattenPayload({ tags: [], meta: {}, gone: null });
    expect(fields.map((field) => [field.path, field.value, field.kind])).toEqual([
      ["tags", "[]", "empty"],
      ["meta", "{}", "empty"],
      ["gone", "null", "null"],
    ]);
  });

  test("labels a bare value", () => {
    expect(flattenPayload("hello").fields).toEqual([{ path: "(value)", value: "hello", kind: "string" }]);
  });

  test("stops at the limit and says so", () => {
    const result = flattenPayload(
      Array.from({ length: 10 }, (_, index) => index),
      4
    );
    expect(result.fields).toHaveLength(4);
    expect(result.truncated).toBe(true);
  });
});

describe("splitCloudEvent", () => {
  test("separates the envelope from the content", () => {
    const parts = splitCloudEvent('{"type":"channel.cheer","id":"e1","data":{"bits":5}}');
    expect(parts?.attributes).toEqual({ type: "channel.cheer", id: "e1" });
    expect(parts?.data).toEqual({ bits: 5 });
  });

  test("returns null for anything but a JSON object", () => {
    expect(splitCloudEvent("nope")).toBeNull();
    expect(splitCloudEvent("[1]")).toBeNull();
  });
});

describe("formatPayload", () => {
  test("pretty-prints JSON and leaves other text alone", () => {
    expect(formatPayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatPayload("plain")).toBe("plain");
  });
});
