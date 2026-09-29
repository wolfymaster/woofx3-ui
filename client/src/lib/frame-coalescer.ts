/**
 * Holds the latest value pushed during an animation frame and delivers it once
 * when the frame fires. Pointer events can arrive at several hundred hertz;
 * committing each one to React state re-renders far more often than the
 * screen can show, so pointer-driven state goes through this instead.
 *
 * Latest-wins, not accumulate: callers push absolute values (a position
 * derived from where the pointer is now), so a dropped intermediate value
 * loses nothing.
 */
export interface FrameCoalescer<T> {
  push(value: T): void;
  /** Delivers a pending value now instead of on the next frame. */
  flush(): void;
  /** Drops a pending value without delivering it. */
  cancel(): void;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export const animationFrameScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export function createFrameCoalescer<T>(
  onFlush: (value: T) => void,
  scheduler: FrameScheduler = animationFrameScheduler
): FrameCoalescer<T> {
  let frame: number | null = null;
  let pending: { value: T } | null = null;

  const deliver = (): void => {
    frame = null;
    if (pending === null) {
      return;
    }
    const { value } = pending;
    pending = null;
    onFlush(value);
  };

  const cancel = (): void => {
    if (frame !== null) {
      scheduler.cancel(frame);
      frame = null;
    }
    pending = null;
  };

  return {
    push(value: T): void {
      pending = { value };
      if (frame === null) {
        frame = scheduler.request(deliver);
      }
    },
    flush(): void {
      if (frame !== null) {
        scheduler.cancel(frame);
      }
      deliver();
    },
    cancel,
  };
}
