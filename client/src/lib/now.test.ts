import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { atom, STORE_UNMOUNT_DELAY } from "nanostores";
import { createTicker } from "./now";

describe("createTicker", () => {
  let clock = 0;
  const readClock = () => clock;

  beforeEach(() => {
    clock = 1_000;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not tick while nothing is subscribed", () => {
    let reads = 0;
    createTicker(1000, () => {
      reads += 1;
      return clock;
    });
    const readsAtCreation = reads;
    jest.advanceTimersByTime(5_000);
    expect(reads).toBe(readsAtCreation);
  });

  it("refreshes on first subscribe and then ticks once per interval", () => {
    const $now = createTicker(1000, readClock);
    clock = 9_000;
    const seen: number[] = [];
    const unsubscribe = $now.listen((value) => seen.push(value));
    expect($now.get()).toBe(9_000);

    clock = 10_000;
    jest.advanceTimersByTime(1000);
    clock = 11_000;
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([10_000, 11_000]);
    unsubscribe();
  });

  it("runs a single interval however many listeners subscribe", () => {
    let reads = 0;
    const countingClock = () => {
      reads += 1;
      return clock;
    };
    const $counted = createTicker(1000, countingClock);
    const unsubscribers = [$counted.listen(() => {}), $counted.listen(() => {}), $counted.listen(() => {})];
    const readsAfterMount = reads;
    jest.advanceTimersByTime(3000);
    expect(reads - readsAfterMount).toBe(3);
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  });

  it("stops ticking once the last listener leaves", () => {
    let reads = 0;
    const $now = createTicker(1000, () => {
      reads += 1;
      return clock;
    });
    const unsubscribe = $now.listen(() => {});
    unsubscribe();
    jest.advanceTimersByTime(STORE_UNMOUNT_DELAY);
    const readsAfterUnmount = reads;
    jest.advanceTimersByTime(10_000);
    expect(reads).toBe(readsAfterUnmount);
  });

  it("pauses while hidden and refreshes on becoming visible", () => {
    const $visible = atom(true);
    const $now = createTicker(1000, readClock, $visible);
    const seen: number[] = [];
    const unsubscribe = $now.listen((value) => seen.push(value));

    $visible.set(false);
    clock = 5_000;
    jest.advanceTimersByTime(3000);
    expect(seen).toEqual([]);

    $visible.set(true);
    expect(seen).toEqual([5_000]);
    clock = 6_000;
    jest.advanceTimersByTime(1000);
    expect(seen).toEqual([5_000, 6_000]);
    unsubscribe();
  });

  it("rejects a non-positive interval", () => {
    expect(() => createTicker(0, readClock)).toThrow();
  });
});
