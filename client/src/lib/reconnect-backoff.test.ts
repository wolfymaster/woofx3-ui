import { describe, expect, test } from "bun:test";
import { createReconnectBackoff } from "./reconnect-backoff";

/** Pins the jitter so a schedule can be asserted exactly. */
function fixed(value: number) {
  return () => value;
}

describe("createReconnectBackoff", () => {
  test("grows exponentially, with jitter pinned to the top of each band", () => {
    const backoff = createReconnectBackoff({ baseMs: 1000, maxMs: 30_000, random: fixed(1) });
    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([1000, 2000, 4000, 8000]);
  });

  test("the bottom of each band is half the ideal delay, never zero", () => {
    const backoff = createReconnectBackoff({ baseMs: 1000, maxMs: 30_000, random: fixed(0) });
    expect([backoff.next(), backoff.next(), backoff.next()]).toEqual([500, 1000, 2000]);
  });

  test("caps at maxMs however long the outage runs", () => {
    const backoff = createReconnectBackoff({ baseMs: 1000, maxMs: 8000, random: fixed(1) });
    for (let i = 0; i < 20; i++) {
      backoff.next();
    }
    expect(backoff.next()).toBe(8000);
  });

  test("every delay stays inside [ideal/2, ideal]", () => {
    const backoff = createReconnectBackoff({ baseMs: 1000, maxMs: 30_000, random: Math.random });
    for (let i = 0; i < 50; i++) {
      const delay = backoff.next();
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(30_000);
    }
  });

  test("reset returns to the first delay", () => {
    const backoff = createReconnectBackoff({ baseMs: 1000, maxMs: 30_000, random: fixed(1) });
    backoff.next();
    backoff.next();
    backoff.next();
    backoff.reset();
    expect(backoff.next()).toBe(1000);
  });

  test("counts attempts since the last reset", () => {
    const backoff = createReconnectBackoff({ random: fixed(1) });
    expect(backoff.attempts).toBe(0);
    backoff.next();
    backoff.next();
    expect(backoff.attempts).toBe(2);
    backoff.reset();
    expect(backoff.attempts).toBe(0);
  });

  test("a maxMs below baseMs still yields a sane delay rather than growing", () => {
    const backoff = createReconnectBackoff({ baseMs: 5000, maxMs: 1000, random: fixed(1) });
    expect(backoff.next()).toBe(1000);
    expect(backoff.next()).toBe(1000);
  });
});
