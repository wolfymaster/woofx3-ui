import { describe, expect, test } from "bun:test";
import { examplePayloadFromShape } from "./test-event-payload";

describe("examplePayloadFromShape", () => {
  test("starts from an empty object when the trigger declares nothing", () => {
    expect(examplePayloadFromShape([])).toEqual({});
  });

  test("uses each field's example, or an empty value of its type", () => {
    expect(
      examplePayloadFromShape([
        { path: "userName", type: "string", example: "alice" },
        { path: "amount", type: "number" },
        { path: "isAnonymous", type: "boolean" },
        { path: "badges", type: "array" },
        { path: "extra", type: "unknown" },
      ])
    ).toEqual({ userName: "alice", amount: 0, isAnonymous: false, badges: [], extra: null });
  });

  test("nests dot paths, and a parent declared after its children keeps them", () => {
    expect(
      examplePayloadFromShape([
        { path: "channel.title", type: "string", example: "hi" },
        { path: "channel.viewers", type: "number" },
        { path: "channel", type: "object" },
      ])
    ).toEqual({ channel: { title: "hi", viewers: 0 } });
  });

  test("empty object and array values are not shared between payloads", () => {
    const fields = [{ path: "reward", type: "object" as const }];
    const first = examplePayloadFromShape(fields);
    (first.reward as Record<string, unknown>).title = "mutated";
    expect(examplePayloadFromShape(fields)).toEqual({ reward: {} });
  });
});
