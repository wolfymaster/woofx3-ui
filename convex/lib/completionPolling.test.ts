import { describe, expect, test } from "bun:test";
import { CORRELATION_TIMEOUT_MS, nextPollDelayMs } from "./completionPolling";

describe("nextPollDelayMs", () => {
  test("doubles from the first wait", () => {
    expect(nextPollDelayMs(1)).toBe(150);
    expect(nextPollDelayMs(2)).toBe(300);
    expect(nextPollDelayMs(3)).toBe(600);
  });

  test("is capped", () => {
    expect(nextPollDelayMs(5)).toBe(2_000);
    expect(nextPollDelayMs(50)).toBe(2_000);
  });

  test("rejects a count that is not a positive integer", () => {
    expect(() => nextPollDelayMs(0)).toThrow();
    expect(() => nextPollDelayMs(1.5)).toThrow();
  });

  test("a wait that times out makes at most 10 looks", () => {
    let elapsed = 0;
    let polls = 1;
    while (elapsed + nextPollDelayMs(polls) < CORRELATION_TIMEOUT_MS) {
      elapsed += nextPollDelayMs(polls);
      polls++;
    }
    expect(polls).toBeLessThanOrEqual(10);
  });
});
