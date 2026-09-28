import { describe, expect, test } from "bun:test";
import { alertQueueSnapshot, clearConfirmLabel, clearResultToast, skipResultToast } from "./alert-queue";

describe("alertQueueSnapshot", () => {
  test("counts waiting alerts and notices the one playing", () => {
    const snapshot = alertQueueSnapshot([
      { status: "pending" },
      { status: "pending" },
      { status: "playing" },
      { status: "completed" },
      { status: "skipped" },
    ]);
    expect(snapshot).toEqual({ waiting: 2, playing: true });
  });

  test("treats a dispatched alert as in flight, not waiting", () => {
    expect(alertQueueSnapshot([{ status: "dispatched" }])).toEqual({ waiting: 0, playing: true });
  });

  test("an empty or settled log is an idle queue", () => {
    expect(alertQueueSnapshot([])).toEqual({ waiting: 0, playing: false });
    expect(alertQueueSnapshot([{ status: "failed" }, { status: "replayed" }])).toEqual({
      waiting: 0,
      playing: false,
    });
  });
});

describe("skipResultToast", () => {
  test("says the queue moved on when something was skipped", () => {
    expect(skipResultToast({ skipped: true }).title).toBe("Alert skipped");
  });

  test("says nothing was playing rather than reporting a failure", () => {
    expect(skipResultToast({ skipped: false }).title).toBe("Nothing to skip");
  });
});

describe("clearResultToast", () => {
  test("pluralises the dropped count", () => {
    expect(clearResultToast({ cleared: 1 }).description).toContain("1 waiting alert.");
    expect(clearResultToast({ cleared: 12 }).description).toContain("12 waiting alerts.");
  });

  test("reports an already-empty queue", () => {
    expect(clearResultToast({ cleared: 0 }).title).toBe("Queue already empty");
  });

  test("rejects a count the engine should never send", () => {
    expect(() => clearResultToast({ cleared: -1 })).toThrow();
    expect(() => clearResultToast({ cleared: 1.5 })).toThrow();
  });
});

describe("clearConfirmLabel", () => {
  test("names the count when the log knows it", () => {
    expect(clearConfirmLabel(1)).toBe("Drop 1 waiting alert?");
    expect(clearConfirmLabel(4)).toBe("Drop 4 waiting alerts?");
  });

  // The log is a window: zero waiting in it does not prove the engine's queue is empty.
  test("still asks when the log shows nothing waiting", () => {
    expect(clearConfirmLabel(0)).toBe("Clear the queue?");
  });
});
