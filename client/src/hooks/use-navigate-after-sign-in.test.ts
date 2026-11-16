import { describe, expect, test } from "bun:test";
import { type AfterSignInStep, afterSignInStep } from "./use-navigate-after-sign-in";

describe("afterSignInStep", () => {
  test.each<[string | null, boolean, boolean, AfterSignInStep]>([
    [null, false, false, "idle"],
    [null, true, true, "idle"],
    ["/x", false, false, "wait"],
    ["/x", true, false, "navigate"],
    ["/x", true, true, "navigate"],
    ["/x", false, true, "reload"],
  ])("pending %p, authenticated %p, timed out %p -> %s", (pending, authenticated, timedOut, expected) => {
    expect(afterSignInStep(pending, authenticated, timedOut)).toBe(expected);
  });
});
