import { describe, expect, test } from "bun:test";
import {
  type CheckoutPoll,
  type CheckoutPollEvent,
  INITIAL_CHECKOUT_POLL,
  nextCheckoutPoll,
  parseCheckoutReturn,
  purchaseReturnSettled,
  withoutCheckoutReturn,
} from "./checkout-return";

describe("parseCheckoutReturn", () => {
  test.each([
    ["", { kind: "none" }],
    ["?checkout=done&checkoutId=c1", { kind: "done", checkoutId: "c1" }],
    ["checkout=done", { kind: "done", checkoutId: null }],
    ["?checkout=done&checkoutId=", { kind: "done", checkoutId: null }],
    ["?checkout=cancelled&checkoutId=c1", { kind: "cancelled" }],
    ["?checkout=weird", { kind: "none" }],
  ])("%p", (search, expected) => {
    expect(parseCheckoutReturn(search)).toEqual(expected);
  });
});

describe("nextCheckoutPoll", () => {
  const MAX = 3;
  const answered = (
    state: "open" | "awaiting_payment" | "complete" | "expired",
    reflected = true
  ): CheckoutPollEvent => ({ type: "answered", state, reflected });

  test.each<[string, CheckoutPoll, CheckoutPollEvent, CheckoutPoll]>([
    ["complete ends it", INITIAL_CHECKOUT_POLL, answered("complete"), { phase: "complete" }],
    [
      "paid but not yet projected keeps asking",
      INITIAL_CHECKOUT_POLL,
      answered("complete", false),
      { phase: "polling", attempts: 1 },
    ],
    [
      "paid but never projected times out",
      { phase: "polling", attempts: MAX - 1 },
      answered("complete", false),
      { phase: "timed_out" },
    ],
    [
      "projected after a few asks completes",
      { phase: "polling", attempts: 2 },
      answered("complete"),
      { phase: "complete" },
    ],
    ["expired ends it", INITIAL_CHECKOUT_POLL, answered("expired"), { phase: "expired" }],
    ["open keeps asking", INITIAL_CHECKOUT_POLL, answered("open"), { phase: "polling", attempts: 1 }],
    [
      "awaiting payment keeps asking",
      INITIAL_CHECKOUT_POLL,
      answered("awaiting_payment"),
      { phase: "polling", attempts: 1 },
    ],
    ["a failed ask keeps asking", INITIAL_CHECKOUT_POLL, { type: "failed" }, { phase: "polling", attempts: 1 }],
    [
      "the last allowed ask times out",
      { phase: "polling", attempts: MAX - 1 },
      answered("open"),
      { phase: "timed_out" },
    ],
    [
      "a failure on the last ask times out",
      { phase: "polling", attempts: MAX - 1 },
      { type: "failed" },
      { phase: "timed_out" },
    ],
    [
      "complete still wins on the last ask",
      { phase: "polling", attempts: MAX - 1 },
      answered("complete"),
      { phase: "complete" },
    ],
    ["a finished poll ignores late answers", { phase: "complete" }, answered("expired"), { phase: "complete" }],
    ["a timed out poll stays timed out", { phase: "timed_out" }, answered("complete"), { phase: "timed_out" }],
  ])("%s", (_name, poll, event, expected) => {
    expect(nextCheckoutPoll(poll, event, MAX)).toEqual(expected);
  });
});

describe("withoutCheckoutReturn", () => {
  test.each([
    ["?checkout=done&checkoutId=c1", ""],
    ["?tab=settings&checkout=done&checkoutId=c1", "?tab=settings"],
    ["?purchase=success", ""],
    ["?checkout=cancelled&checkoutId=c1&tab=readme", "?tab=readme"],
    ["", ""],
  ])("%p becomes %p", (search, expected) => {
    expect(withoutCheckoutReturn(search)).toBe(expected);
  });
});

describe("purchaseReturnSettled", () => {
  test.each([
    ["licensed", true],
    ["installed", true],
    ["finalizing_payment", false],
    ["failed", false],
    [undefined, false],
  ])("%p settles the return: %p", (step, expected) => {
    expect(purchaseReturnSettled(step)).toBe(expected);
  });
});
