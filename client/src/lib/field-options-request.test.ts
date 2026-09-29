import { describe, expect, test } from "bun:test";
import { ConvexError } from "convex/values";
import { dispatchErrorMessage, fieldOptionsRequestKey } from "./field-options-request";

describe("fieldOptionsRequestKey", () => {
  test("is equal for equal requests built as separate objects", () => {
    const first = { kind: "internal", request: { event: "engine.obs.options", payload: { list: "scenes" } } };
    const second = { kind: "internal", request: { event: "engine.obs.options", payload: { list: "scenes" } } };
    expect(first).not.toBe(second);
    expect(fieldOptionsRequestKey(first)).toBe(fieldOptionsRequestKey(second));
  });

  test("ignores key order at every depth", () => {
    expect(fieldOptionsRequestKey({ a: 1, b: { c: 2, d: [1, { f: 1, e: 2 }] } })).toBe(
      fieldOptionsRequestKey({ b: { d: [1, { e: 2, f: 1 }], c: 2 }, a: 1 })
    );
  });

  test("differs when any part of the request differs", () => {
    expect(fieldOptionsRequestKey({ payload: { list: "scenes" } })).not.toBe(
      fieldOptionsRequestKey({ payload: { list: "sources" } })
    );
    expect(fieldOptionsRequestKey({ items: [1, 2] })).not.toBe(fieldOptionsRequestKey({ items: [2, 1] }));
  });
});

describe("dispatchErrorMessage", () => {
  test("reads a ConvexError's string data", () => {
    expect(dispatchErrorMessage(new ConvexError("Update the dashboard"))).toBe("Update the dashboard");
  });

  test("reads a ConvexError's { message } data", () => {
    expect(dispatchErrorMessage(new ConvexError({ message: "Unknown module" }))).toBe("Unknown module");
  });

  test("falls back to the error's message, then a generic reason", () => {
    expect(dispatchErrorMessage(new Error("Instance is not registered with the engine"))).toBe(
      "Instance is not registered with the engine"
    );
    expect(dispatchErrorMessage(new Error(""))).toBe("Request failed");
    expect(dispatchErrorMessage("nope")).toBe("Request failed");
  });
});
