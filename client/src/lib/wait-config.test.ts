import { describe, expect, it } from "bun:test";
import {
  DEFAULT_AGGREGATION,
  DEFAULT_DELAY_MS,
  DELAY_BOUNDS,
  describeWaitTimeout,
  durationAmount,
  formatDelay,
  formatGoDuration,
  parseDurationInput,
  parseGoDuration,
  pickDurationUnit,
  setWaitTimeoutEnabled,
  switchWaitType,
  TIMEOUT_BOUNDS,
  WAIT_DELAY_MAX_MS,
  waitNodeLabel,
} from "./wait-config";

describe("formatDelay", () => {
  it("formats whole seconds, minutes and hours", () => {
    expect(formatDelay(10_000)).toBe("10s");
    expect(formatDelay(150_000)).toBe("2m 30s");
    expect(formatDelay(120_000)).toBe("2m");
    expect(formatDelay(3_900_000)).toBe("1h 5m");
    expect(formatDelay(WAIT_DELAY_MAX_MS)).toBe("24h");
  });

  it("keeps sub-second precision", () => {
    expect(formatDelay(500)).toBe("500ms");
    expect(formatDelay(1)).toBe("1ms");
    expect(formatDelay(1500)).toBe("1.5s");
  });
});

describe("Go durations", () => {
  it("formats without spaces", () => {
    expect(formatGoDuration(30_000)).toBe("30s");
    expect(formatGoDuration(5_400_000)).toBe("1h30m");
    expect(formatGoDuration(150_000)).toBe("2m30s");
    expect(formatGoDuration(1500)).toBe("1.5s");
  });

  it("parses what the engine accepts", () => {
    expect(parseGoDuration("30s")).toBe(30_000);
    expect(parseGoDuration("5m")).toBe(300_000);
    expect(parseGoDuration("1h30m")).toBe(5_400_000);
    expect(parseGoDuration("1.5s")).toBe(1500);
    expect(parseGoDuration("250ms")).toBe(250);
  });

  it("round-trips its own output", () => {
    for (const ms of [1000, 45_000, 90_000, 3_600_000, 5_430_000]) {
      expect(parseGoDuration(formatGoDuration(ms))).toBe(ms);
    }
  });

  it("refuses anything else", () => {
    expect(parseGoDuration("")).toBeNull();
    expect(parseGoDuration("30")).toBeNull();
    expect(parseGoDuration("-5s")).toBeNull();
    expect(parseGoDuration("5 m")).toBeNull();
    expect(parseGoDuration("5x")).toBeNull();
  });
});

describe("pickDurationUnit and durationAmount", () => {
  it("uses the largest unit that divides evenly", () => {
    expect(pickDurationUnit(120_000, ["seconds", "minutes"])).toBe("minutes");
    expect(pickDurationUnit(90_000, ["seconds", "minutes"])).toBe("seconds");
    expect(pickDurationUnit(7_200_000, ["seconds", "minutes", "hours"])).toBe("hours");
    expect(pickDurationUnit(7_200_000, ["seconds", "minutes"])).toBe("minutes");
    expect(pickDurationUnit(500, ["seconds", "minutes"])).toBe("seconds");
  });

  it("expresses the duration in the unit", () => {
    expect(durationAmount(120_000, "minutes")).toBe(2);
    expect(durationAmount(90_000, "minutes")).toBe(1.5);
    expect(durationAmount(10_000, "seconds")).toBe(10);
    expect(durationAmount(1, "seconds")).toBe(0.001);
  });
});

describe("parseDurationInput", () => {
  it("stores whole milliseconds", () => {
    expect(parseDurationInput("10", "seconds", DELAY_BOUNDS)).toEqual({ ok: true, durationMs: 10_000 });
    expect(parseDurationInput(" 2.5 ", "minutes", DELAY_BOUNDS)).toEqual({ ok: true, durationMs: 150_000 });
    expect(parseDurationInput("0.0016", "seconds", DELAY_BOUNDS)).toEqual({ ok: true, durationMs: 2 });
  });

  it("refuses empty, non-numeric and out-of-range delays", () => {
    expect(parseDurationInput("", "seconds", DELAY_BOUNDS).ok).toBe(false);
    expect(parseDurationInput("abc", "seconds", DELAY_BOUNDS).ok).toBe(false);
    expect(parseDurationInput("-5", "seconds", DELAY_BOUNDS).ok).toBe(false);
    expect(parseDurationInput("0.0004", "seconds", DELAY_BOUNDS)).toEqual({
      ok: false,
      message: "Must be longer than 0.",
    });
    expect(parseDurationInput("1440", "minutes", DELAY_BOUNDS)).toEqual({ ok: true, durationMs: WAIT_DELAY_MAX_MS });
    expect(parseDurationInput("1441", "minutes", DELAY_BOUNDS)).toEqual({
      ok: false,
      message: "Must be 24 hours or less.",
    });
  });

  it("holds timeouts to at least one second with no upper bound", () => {
    expect(parseDurationInput("0.5", "seconds", TIMEOUT_BOUNDS)).toEqual({
      ok: false,
      message: "Must be at least 1 second.",
    });
    expect(parseDurationInput("1", "seconds", TIMEOUT_BOUNDS)).toEqual({ ok: true, durationMs: 1000 });
    expect(parseDurationInput("48", "hours", TIMEOUT_BOUNDS)).toEqual({ ok: true, durationMs: 172_800_000 });
  });
});

describe("switchWaitType", () => {
  it("drops every event field when switching to a delay", () => {
    const next = switchWaitType(
      {
        type: "aggregation",
        event: "twitch.follow",
        conditions: [{ field: "user", operator: "eq", value: "x" }],
        aggregation: DEFAULT_AGGREGATION,
        timeout: "30s",
        onTimeout: "continue",
      },
      "delay"
    );
    expect(next).toEqual({ type: "delay", durationMs: DEFAULT_DELAY_MS });
  });

  it("restores an empty event when leaving a delay", () => {
    expect(switchWaitType({ type: "delay", durationMs: 1000 }, "event")).toEqual({ type: "event", event: "" });
    expect(switchWaitType({ type: "delay", durationMs: 1000 }, "aggregation")).toEqual({
      type: "aggregation",
      event: "",
      aggregation: DEFAULT_AGGREGATION,
    });
  });

  it("keeps the event and timeout between event and aggregation", () => {
    const next = switchWaitType({ type: "event", event: "twitch.follow", timeout: "30s" }, "aggregation");
    expect(next).toMatchObject({ type: "aggregation", event: "twitch.follow", timeout: "30s" });
  });

  it("returns the same wait when the type is unchanged", () => {
    const wait = { type: "delay", durationMs: 1000 } as const;
    expect(switchWaitType(wait, "delay")).toBe(wait);
  });
});

describe("setWaitTimeoutEnabled", () => {
  it("adds a default timeout and keeps an existing one", () => {
    expect(setWaitTimeoutEnabled({ type: "event", event: "x" }, true)).toEqual({
      type: "event",
      event: "x",
      timeout: "5m",
    });
    expect(setWaitTimeoutEnabled({ type: "event", event: "x", timeout: "30s" }, true)).toMatchObject({
      timeout: "30s",
    });
  });

  it("drops the timeout and its action when turned off", () => {
    expect(setWaitTimeoutEnabled({ type: "event", event: "x", timeout: "30s", onTimeout: "continue" }, false)).toEqual({
      type: "event",
      event: "x",
    });
  });
});

describe("describeWaitTimeout", () => {
  it("says a wait with no timeout waits for the event", () => {
    expect(describeWaitTimeout({ type: "event", event: "x" })).toBe("No timeout, waits until the event arrives");
  });

  it("defaults the timeout action to fail", () => {
    expect(describeWaitTimeout({ type: "event", event: "x", timeout: "1h30m" })).toBe(
      "Gives up after 1h 30m, then fails the workflow"
    );
  });

  it("uses the configured action", () => {
    expect(describeWaitTimeout({ type: "event", event: "x", timeout: "30s", onTimeout: "continue" })).toBe(
      "Gives up after 30s, then continues"
    );
  });
});

describe("waitNodeLabel", () => {
  it("names each kind of wait", () => {
    expect(waitNodeLabel({ type: "delay", durationMs: 150_000 })).toBe("2m 30s");
    expect(waitNodeLabel({ type: "event", event: "twitch.follow" })).toBe("Until twitch.follow");
    expect(waitNodeLabel({ type: "event", event: "" })).toBe("Until an event");
    expect(
      waitNodeLabel({ type: "aggregation", event: "twitch.follow", aggregation: { strategy: "count", threshold: 5 } })
    ).toBe("Until twitch.follow ×5");
    expect(
      waitNodeLabel({ type: "aggregation", event: "twitch.bits", aggregation: { strategy: "sum", threshold: 1000 } })
    ).toBe("Until twitch.bits totals 1000");
  });
});
