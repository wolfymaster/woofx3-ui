import { describe, expect, test } from "bun:test";
import { earliestEligibleAt, nextSendAt, pickNextEntry, retryDelayMs, SHOUTOUT_COOLDOWN_MS } from "./shoutoutSchedule";

const NOW = 1_000_000;

function entry(sortOrder: number, nextEligibleAt: number) {
  return { sortOrder, nextEligibleAt };
}

describe("nextSendAt", () => {
  test("sends immediately when nothing has been sent yet", () => {
    expect(nextSendAt(undefined, NOW)).toBe(NOW);
  });

  test("holds the full cooldown after a recent send", () => {
    expect(nextSendAt(NOW, NOW)).toBe(NOW + SHOUTOUT_COOLDOWN_MS);
  });

  test("sends immediately once the cooldown has already elapsed", () => {
    expect(nextSendAt(NOW - SHOUTOUT_COOLDOWN_MS - 1, NOW)).toBe(NOW);
  });

  test("never returns a time in the past", () => {
    expect(nextSendAt(NOW - 10 * SHOUTOUT_COOLDOWN_MS, NOW)).toBe(NOW);
  });
});

describe("retryDelayMs", () => {
  test("the first failure waits one cooldown", () => {
    expect(retryDelayMs(1)).toBe(120_000);
  });

  test("grows with each successive failure", () => {
    expect(retryDelayMs(2)).toBe(240_000);
    expect(retryDelayMs(3)).toBe(480_000);
  });

  test("caps at fifteen minutes however many times it has failed", () => {
    expect(retryDelayMs(4)).toBe(900_000);
    expect(retryDelayMs(50)).toBe(900_000);
  });

  test("treats a zeroth attempt as the first rather than going below the base", () => {
    expect(retryDelayMs(0)).toBe(120_000);
  });
});

describe("pickNextEntry", () => {
  test("takes the lowest sortOrder among eligible entries", () => {
    const entries = [entry(2, NOW - 1), entry(1, NOW - 1), entry(3, NOW - 1)];
    expect(pickNextEntry(entries, NOW)?.sortOrder).toBe(1);
  });

  test("skips past an entry still backing off rather than stalling behind it", () => {
    const entries = [entry(1, NOW + 60_000), entry(2, NOW - 1)];
    expect(pickNextEntry(entries, NOW)?.sortOrder).toBe(2);
  });

  test("an entry eligible exactly now is eligible", () => {
    expect(pickNextEntry([entry(1, NOW)], NOW)?.sortOrder).toBe(1);
  });

  test("returns null when every entry is still waiting", () => {
    expect(pickNextEntry([entry(1, NOW + 1), entry(2, NOW + 5)], NOW)).toBeNull();
  });

  test("returns null for an empty queue", () => {
    expect(pickNextEntry([], NOW)).toBeNull();
  });

  test("does not assume the input is sorted", () => {
    const entries = [entry(9, NOW - 1), entry(4, NOW - 1), entry(7, NOW - 1)];
    expect(pickNextEntry(entries, NOW)?.sortOrder).toBe(4);
  });
});

describe("earliestEligibleAt", () => {
  test("finds the soonest entry to become eligible", () => {
    expect(earliestEligibleAt([entry(1, NOW + 500), entry(2, NOW + 100)])).toBe(NOW + 100);
  });

  test("is null for an empty queue", () => {
    expect(earliestEligibleAt([])).toBeNull();
  });

  test("ignores queue order entirely", () => {
    expect(earliestEligibleAt([entry(9, NOW + 10), entry(1, NOW + 900)])).toBe(NOW + 10);
  });
});
