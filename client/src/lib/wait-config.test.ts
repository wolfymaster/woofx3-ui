import { describe, expect, it } from "bun:test";
import {
  DEFAULT_AGGREGATION,
  DEFAULT_DELAY_MS,
  delayAmount,
  describeWaitTimeout,
  formatDelay,
  parseDelayInput,
  pickDelayUnit,
  switchWaitType,
  WAIT_DELAY_MAX_MS,
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

describe("pickDelayUnit and delayAmount", () => {
  it("uses minutes only for whole minutes", () => {
    expect(pickDelayUnit(120_000)).toBe("minutes");
    expect(pickDelayUnit(90_000)).toBe("seconds");
    expect(pickDelayUnit(10_000)).toBe("seconds");
  });

  it("expresses the duration in the unit", () => {
    expect(delayAmount(120_000, "minutes")).toBe(2);
    expect(delayAmount(90_000, "minutes")).toBe(1.5);
    expect(delayAmount(10_000, "seconds")).toBe(10);
    expect(delayAmount(1, "seconds")).toBe(0.001);
  });
});

describe("parseDelayInput", () => {
  it("stores whole milliseconds", () => {
    expect(parseDelayInput("10", "seconds")).toEqual({ ok: true, durationMs: 10_000 });
    expect(parseDelayInput(" 2.5 ", "minutes")).toEqual({ ok: true, durationMs: 150_000 });
    expect(parseDelayInput("0.0004", "seconds")).toEqual({ ok: false, message: "Must be longer than 0." });
    expect(parseDelayInput("0.0016", "seconds")).toEqual({ ok: true, durationMs: 2 });
  });

  it("refuses empty, non-numeric and out-of-range input", () => {
    expect(parseDelayInput("", "seconds").ok).toBe(false);
    expect(parseDelayInput("abc", "seconds").ok).toBe(false);
    expect(parseDelayInput("0", "seconds").ok).toBe(false);
    expect(parseDelayInput("-5", "seconds").ok).toBe(false);
    expect(parseDelayInput("1440", "minutes")).toEqual({ ok: true, durationMs: WAIT_DELAY_MAX_MS });
    expect(parseDelayInput("1441", "minutes")).toEqual({ ok: false, message: "Must be 24 hours or less." });
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

describe("describeWaitTimeout", () => {
  it("spells out the engine defaults", () => {
    expect(describeWaitTimeout({ type: "event", event: "x" })).toBe(
      "Gives up after 5m (default), then fails the workflow"
    );
  });

  it("uses the configured timeout and action", () => {
    expect(describeWaitTimeout({ type: "event", event: "x", timeout: "30s", onTimeout: "continue" })).toBe(
      "Gives up after 30s, then continues"
    );
  });
});
