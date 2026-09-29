/**
 * Trailing-edge debounce: `onSettle` receives the latest pushed value once
 * `delayMs` has passed without another push. Kept free of React so the timing
 * can be tested with fake timers; `useDebouncedValue` wraps it for components.
 */
export interface Debouncer<T> {
  push(value: T): void;
  /** Drops a pending value without delivering it. */
  cancel(): void;
}

export function createDebouncer<T>(delayMs: number, onSettle: (value: T) => void): Debouncer<T> {
  if (!(Number.isFinite(delayMs) && delayMs >= 0)) {
    throw new Error(`createDebouncer: delayMs must be a non-negative number, got ${delayMs}`);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    push(value: T): void {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        onSettle(value);
      }, delayMs);
    },
    cancel,
  };
}
