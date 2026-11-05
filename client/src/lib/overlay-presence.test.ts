import { describe, expect, test } from "bun:test";
import { overlayPresenceOf } from "./overlay-presence";

describe("overlayPresenceOf", () => {
  test.each([
    ["a readable queue", { ok: true }, "open"],
    ["the engine saying none is open", { ok: false, reason: "no overlay is open" }, "closed"],
    ["an unanswered scene manager", { ok: false, reason: "the scene manager did not answer: timeout" }, "unknown"],
    ["no reason at all", { ok: false }, "unknown"],
  ] as const)("%s", (_name, queue, expected) => {
    expect(overlayPresenceOf(queue)).toBe(expected);
  });
});
