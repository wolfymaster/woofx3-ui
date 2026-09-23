import { describe, expect, test } from "bun:test";
import {
  counterGoals,
  counterValue,
  formatDuration,
  goalProgress,
  parseDuration,
  queueAddRefusal,
  queueCapacity,
  queueEntries,
  timerState,
} from "@/lib/resource-values";

describe("counterGoals", () => {
  test("goals read smallest first, without repeats or entries that are not numbers", () => {
    expect(counterGoals(null, { goals: "500, 100, abc, 250, 100, " }).map((entry) => entry.goal)).toEqual([
      100, 250, 500,
    ]);
  });

  test("a goal in the reached record carries when it was first reached", () => {
    const value = { value: 300, reached: { "100": 1_790_000_000_000, "250": 1_790_000_100_000 } };
    expect(counterGoals(value, { goals: "100, 250, 500" })).toEqual([
      { goal: 100, name: "", reachedAt: 1_790_000_000_000 },
      { goal: 250, name: "", reachedAt: 1_790_000_100_000 },
      { goal: 500, name: "", reachedAt: null },
    ]);
  });

  test("a counter written as a bare number, or with no goals set, has nothing reached", () => {
    expect(counterGoals(42, { goals: "10" })).toEqual([{ goal: 10, name: "", reachedAt: null }]);
    expect(counterGoals(42, {})).toEqual([]);
    expect(counterGoals(42, { goals: "" })).toEqual([]);
    expect(counterGoals(42, { goals: [] })).toEqual([]);
  });

  test("goals set as rows carry their names, smallest first", () => {
    const goals = [{ value: 250, name: " Hat " }, { value: 100 }, { value: "50", name: "Emote" }];
    expect(counterGoals(null, { goals })).toEqual([
      { goal: 50, name: "Emote", reachedAt: null },
      { goal: 100, name: "", reachedAt: null },
      { goal: 250, name: "Hat", reachedAt: null },
    ]);
  });

  test("a row with no usable number is skipped, and a repeated number takes its first name", () => {
    const goals = [{ value: "", name: "Unfinished" }, { name: "No number" }, { value: 10 }, { value: 10, name: "Ten" }];
    expect(counterGoals(null, { goals })).toEqual([{ goal: 10, name: "Ten", reachedAt: null }]);
  });
});

describe("goalProgress", () => {
  const goals = (...values: number[]) => values.map((goal) => ({ goal, name: "", reachedAt: null }));

  test("runs from the counter's start to its largest goal", () => {
    const progress = goalProgress(50, 0, goals(100, 200));
    expect(progress.fraction).toBe(0.25);
    expect(progress.marks).toEqual([0.5, 1]);
    expect(progress.next?.goal).toBe(100);
  });

  test("the next goal is the smallest above the value, so a goal just reached is behind it", () => {
    expect(goalProgress(100, 0, goals(100, 200)).next?.goal).toBe(200);
    expect(goalProgress(200, 0, goals(100, 200)).next).toBeNull();
  });

  test("stays on the bar past either end", () => {
    expect(goalProgress(500, 0, goals(100)).fraction).toBe(1);
    expect(goalProgress(-20, 0, goals(100)).fraction).toBe(0);
  });

  test("stretches to take in a goal below the start", () => {
    const progress = goalProgress(10, 20, goals(0, 40));
    expect(progress.marks).toEqual([0, 1]);
    expect(progress.fraction).toBe(0.25);
  });

  test("a single goal at the start still draws a bar", () => {
    const progress = goalProgress(0, 0, goals(0));
    expect(progress.marks).toEqual([0]);
    expect(Number.isFinite(progress.fraction)).toBe(true);
  });
});

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

describe("counterValue", () => {
  const settings = { initialValue: 7 };

  test("reads the number a counter with goals stores", () => {
    expect(counterValue({ value: 42, reached: {} }, settings)).toBe(42);
    expect(counterValue({ value: 0, reached: { "100": 1 } }, settings)).toBe(0);
  });

  // Counters last written before they carried goals hold a bare number. Reading
  // those as unset would show every one of them its starting value forever
  // while the real number moved underneath.
  test("reads a counter stored as a bare number", () => {
    expect(counterValue(3, settings)).toBe(3);
    expect(counterValue(0, settings)).toBe(0);
  });

  test("falls back to the starting value when nothing is stored", () => {
    expect(counterValue(null, settings)).toBe(7);
    expect(counterValue(undefined, settings)).toBe(7);
    expect(counterValue({ reached: {} }, settings)).toBe(7);
  });

  test("falls back to zero when the starting value is unusable", () => {
    expect(counterValue(null, {})).toBe(0);
    expect(counterValue(null, { initialValue: "lots" })).toBe(0);
  });
});
