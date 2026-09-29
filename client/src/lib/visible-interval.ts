import type { ReadableAtom } from "nanostores";

export interface IntervalTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const globalTimers: IntervalTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Runs `callback` every `ms` while `visible` is true, and not at all while it is
 * false. Becoming visible again fires the callback at once before resuming the
 * cadence, so whatever it refreshes is current the moment someone looks.
 *
 * Starting does not fire the callback: callers already load on mount, and
 * firing here too would double that first request.
 *
 * Returns a function that stops the interval and the visibility subscription.
 */
export function startVisibleInterval(
  callback: () => void,
  ms: number,
  visible: ReadableAtom<boolean>,
  timers: IntervalTimers = globalTimers
): () => void {
  if (!(ms > 0)) {
    throw new Error(`startVisibleInterval: interval must be positive, got ${ms}`);
  }

  let handle: unknown = null;

  const start = () => {
    if (handle === null) {
      handle = timers.setInterval(callback, ms);
    }
  };
  const stop = () => {
    if (handle !== null) {
      timers.clearInterval(handle);
      handle = null;
    }
  };

  if (visible.get()) {
    start();
  }

  // listen (not subscribe) so the current value is not replayed as a change.
  const unlisten = visible.listen((isVisible) => {
    if (isVisible) {
      if (handle === null) {
        callback();
      }
      start();
    } else {
      stop();
    }
  });

  return () => {
    unlisten();
    stop();
  };
}
