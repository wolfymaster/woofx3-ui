import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/** The page's source of time, so tests render a timer at a moment they choose. */
export interface Clock {
  now: () => number;
  /** Calls `callback` after `ms`; the returned function cancels it. */
  after: (ms: number, callback: () => void) => () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  after: (ms, callback) => {
    const handle = setTimeout(callback, ms);
    return () => clearTimeout(handle);
  },
};

const ClockContext = createContext<Clock>(systemClock);

export function useClock(): Clock {
  return useContext(ClockContext);
}

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

/**
 * How long until a countdown ending at `endsAt` next shows a different
 * second, or null once it has ended. The display rounds up (formatDuration),
 * so it changes as the time left crosses each whole second.
 */
export function countdownTickDelay(endsAt: number, now: number): number | null {
  const remaining = endsAt - now;
  if (remaining <= 0) {
    return null;
  }
  return remaining % 1000 || 1000;
}

/**
 * The current time, re-read each time a countdown to `endsAt` ticks over a
 * second and never after it ends. Null `endsAt` reads the time once. The
 * timer is counted down here from when it ends, so nothing is fetched while
 * it runs.
 */
export function useCountdownNow(endsAt: number | null): number {
  const clock = useContext(ClockContext);
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (endsAt === null) {
      return;
    }
    let cancel = () => {};
    const tick = () => {
      const at = clock.now();
      setNow(at);
      const delay = countdownTickDelay(endsAt, at);
      if (delay !== null) {
        cancel = clock.after(delay, tick);
      }
    };
    tick();
    return () => cancel();
  }, [clock, endsAt]);
  return now;
}
