import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  parseDuration,
  queueAddRefusal,
  queueCapacity,
  queueEntries,
  timerState,
} from "@/lib/resource-values";

describe("timerState", () => {
  const now = 1_790_000_000_000;

  test("a running timer's time left counts down from when it ends", () => {
    expect(timerState({ running: true, endsAt: now + 61_500 }, {}, now)).toEqual({
      running: true,
      remainingMs: 61_500,
    });
  });

  test("a running timer that has run out reads as zero, not negative", () => {
    expect(timerState({ running: true, endsAt: now - 5_000 }, {}, now).remainingMs).toBe(0);
  });

  test("a stopped timer keeps the time it has left", () => {
    expect(timerState({ running: false, remainingMs: 42_000 }, { duration: 300 }, now)).toEqual({
      running: false,
      remainingMs: 42_000,
    });
  });

  test("a timer with no value is stopped at its full duration", () => {
    expect(timerState(null, { duration: 90 }, now)).toEqual({ running: false, remainingMs: 90_000 });
    expect(timerState(null, {}, now).remainingMs).toBe(300_000);
  });
});

describe("formatDuration", () => {
  test("minutes and seconds under an hour, hours above", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  test("rounds up, so any time left never shows as none", () => {
    expect(formatDuration(1)).toBe("0:01");
    expect(formatDuration(59_001)).toBe("1:00");
  });
});

describe("parseDuration", () => {
  test("reads seconds, m:ss and h:mm:ss", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration(" 1:30 ")).toBe(90);
    expect(parseDuration("1:02:30")).toBe(3750);
  });

  test("refuses anything else", () => {
    for (const input of ["", "abc", "-5", "1.5", "1::2", "1:2:3:4"]) {
      expect(parseDuration(input)).toBeNull();
    }
  });
});

describe("queueEntries", () => {
  test("an array of entries, or none", () => {
    expect(queueEntries(["alice", "bob"])).toEqual(["alice", "bob"]);
    expect(queueEntries(null)).toEqual([]);
    expect(queueEntries("alice")).toEqual([]);
  });
});

describe("queueCapacity", () => {
  test("its own capacity, bounded by the hard limit, which 0 means", () => {
    expect(queueCapacity({ capacity: 5 })).toBe(5);
    expect(queueCapacity({ capacity: 0 })).toBe(1000);
    expect(queueCapacity({})).toBe(1000);
    expect(queueCapacity({ capacity: 5000 })).toBe(1000);
  });
});

describe("queueAddRefusal", () => {
  test("an entry already in line is a duplicate unless duplicates are allowed", () => {
    expect(queueAddRefusal(["alice"], {}, " alice ")).toBe("duplicate");
    expect(queueAddRefusal(["alice"], { allowDuplicates: true }, "alice")).toBeNull();
  });

  test("a full queue refuses more", () => {
    expect(queueAddRefusal(["alice", "bob"], { capacity: 2 }, "carol")).toBe("full");
    expect(queueAddRefusal(["alice"], { capacity: 2 }, "carol")).toBeNull();
  });
});
