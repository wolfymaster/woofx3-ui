import { describe, expect, test } from "bun:test";
import { LOADING_MESSAGES, nextLoadingMessage } from "./loading-messages";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe("loading messages", () => {
  test("there are plenty, none twice", () => {
    expect(LOADING_MESSAGES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(LOADING_MESSAGES).size).toBe(LOADING_MESSAGES.length);
  });

  test("never repeats immediately and reaches every message", () => {
    const random = seeded(42);
    const seen = new Set<number>();
    let previous: number | null = null;
    for (let turn = 0; turn < 2000; turn++) {
      const next = nextLoadingMessage(LOADING_MESSAGES.length, previous, random);
      expect(next).not.toBe(previous as number);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(LOADING_MESSAGES.length);
      seen.add(next);
      previous = next;
    }
    expect(seen.size).toBe(LOADING_MESSAGES.length);
  });

  test("stays in range at the extremes of the random source", () => {
    expect(nextLoadingMessage(5, 4, () => 0.999999)).toBe(3);
    expect(nextLoadingMessage(5, 0, () => 0)).toBe(1);
    expect(nextLoadingMessage(5, null, () => 0.999999)).toBe(4);
  });
});
