import { describe, expect, test } from "bun:test";
import { atom } from "nanostores";
import { type IntervalTimers, startVisibleInterval } from "./visible-interval";

/** Timers driven by hand: `tick()` fires every live interval once. */
function manualTimers() {
  const live = new Map<number, () => void>();
  let nextId = 1;
  const timers: IntervalTimers = {
    setInterval(callback) {
      const id = nextId++;
      live.set(id, callback);
      return id;
    },
    clearInterval(handle) {
      live.delete(handle as number);
    },
  };
  return {
    timers,
    live,
    tick() {
      live.forEach((callback) => {
        callback();
      });
    },
  };
}

describe("startVisibleInterval", () => {
  test("runs on the cadence while visible, without firing on start", () => {
    const clock = manualTimers();
    let calls = 0;
    startVisibleInterval(() => calls++, 1000, atom(true), clock.timers);
    expect(calls).toBe(0);
    clock.tick();
    clock.tick();
    expect(calls).toBe(2);
  });

  test("holds no timer while hidden", () => {
    const clock = manualTimers();
    const visible = atom(true);
    let calls = 0;
    startVisibleInterval(() => calls++, 1000, visible, clock.timers);
    visible.set(false);
    expect(clock.live.size).toBe(0);
    clock.tick();
    expect(calls).toBe(0);
  });

  test("fires at once on becoming visible, then resumes the cadence", () => {
    const clock = manualTimers();
    const visible = atom(false);
    let calls = 0;
    startVisibleInterval(() => calls++, 1000, visible, clock.timers);
    expect(clock.live.size).toBe(0);
    visible.set(true);
    expect(calls).toBe(1);
    expect(clock.live.size).toBe(1);
    clock.tick();
    expect(calls).toBe(2);
  });

  test("stopping clears the timer and ignores later visibility changes", () => {
    const clock = manualTimers();
    const visible = atom(true);
    let calls = 0;
    const stop = startVisibleInterval(() => calls++, 1000, visible, clock.timers);
    stop();
    expect(clock.live.size).toBe(0);
    visible.set(false);
    visible.set(true);
    expect(calls).toBe(0);
    expect(clock.live.size).toBe(0);
  });

  test("rejects a non-positive interval", () => {
    expect(() => startVisibleInterval(() => {}, 0, atom(true))).toThrow();
  });
});
