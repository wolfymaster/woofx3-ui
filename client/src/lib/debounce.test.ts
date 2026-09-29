import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { createDebouncer } from "./debounce";

describe("createDebouncer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("delivers only the last value of a burst", () => {
    const settled: string[] = [];
    const debouncer = createDebouncer<string>(250, (value) => settled.push(value));
    // Typing "background" one keystroke every 100 ms.
    const word = "background";
    for (let i = 1; i <= word.length; i += 1) {
      debouncer.push(word.slice(0, i));
      jest.advanceTimersByTime(100);
    }
    expect(settled).toEqual([]);
    jest.advanceTimersByTime(150);
    expect(settled).toEqual(["background"]);
  });

  it("delivers each value separated by a pause", () => {
    const settled: string[] = [];
    const debouncer = createDebouncer<string>(250, (value) => settled.push(value));
    debouncer.push("a");
    jest.advanceTimersByTime(250);
    debouncer.push("ab");
    jest.advanceTimersByTime(250);
    expect(settled).toEqual(["a", "ab"]);
  });

  it("drops a pending value on cancel", () => {
    const settled: string[] = [];
    const debouncer = createDebouncer<string>(250, (value) => settled.push(value));
    debouncer.push("a");
    debouncer.cancel();
    jest.advanceTimersByTime(1000);
    expect(settled).toEqual([]);
  });

  it("rejects a negative delay", () => {
    expect(() => createDebouncer(-1, () => {})).toThrow();
  });
});
