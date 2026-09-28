import { describe, expect, test } from "bun:test";
import { clearResultToast, skipResultToast } from "./alert-queue";

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
