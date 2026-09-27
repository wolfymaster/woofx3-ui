import { describe, expect, test } from "bun:test";
import { selectInstance } from "./instance-selection";

const a = { _id: "a" };
const b = { _id: "b" };

describe("selectInstance", () => {
  test("while the list loads, queries scope to the cached id and no instance is confirmed", () => {
    expect(selectInstance(undefined, "b")).toEqual({ instance: null, optimisticInstanceId: "b" });
  });

  test("keeps the cached instance once the list confirms it", () => {
    expect(selectInstance([a, b], "b")).toEqual({ instance: b, optimisticInstanceId: "b" });
  });

  test("a cached id the user no longer has falls back to the first instance", () => {
    expect(selectInstance([a, b], "gone")).toEqual({ instance: a, optimisticInstanceId: "a" });
  });

  test("no cached id selects the first instance, skipping missing rows", () => {
    expect(selectInstance([null, b], null)).toEqual({ instance: b, optimisticInstanceId: "b" });
  });

  test("no instances at all scopes nothing", () => {
    expect(selectInstance([], "gone")).toEqual({ instance: null, optimisticInstanceId: null });
  });
});
