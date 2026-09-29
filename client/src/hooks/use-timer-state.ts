import { useEffect, useState } from "react";
import { type TimerState, timerState } from "@/lib/resource-values";

/**
 * The current time, refreshed several times a second while `ticking`. A
 * running timer is stored as the moment it ends, so showing it counting down
 * is the reader's job; a stopped one needs no refresh.
 */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) {
      return;
    }
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [ticking]);
  return now;
}

/**
 * A timer's live state from its stored value. Every place that shows a timer
 * reads it through here, so two views of the same timer count down together.
 */
export function useTimerState(value: unknown, settings: Record<string, unknown>): TimerState {
  // Whether a timer runs does not depend on the time, only how long it has left.
  const now = useNow(timerState(value, settings, 0).running);
  return timerState(value, settings, now);
}
