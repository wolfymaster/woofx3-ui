import { useEffect, useRef } from "react";
import { $attended } from "@/lib/stores";
import { startVisibleInterval } from "@/lib/visible-interval";

/**
 * `setInterval` that stops while nobody is attending the tab — hidden, or
 * visible but untouched for a while — and fires immediately when someone
 * returns. Background tabs are throttled, not stopped, and a visible tab may
 * have no one in front of it, so a plain interval keeps paying for requests
 * nobody will see.
 *
 * The latest `callback` is always the one called; a new callback identity does
 * not restart the cadence. Pass `enabled = false` to stop it entirely.
 */
export function useAttendedInterval(callback: () => void, ms: number, enabled = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return startVisibleInterval(() => callbackRef.current(), ms, $attended);
  }, [ms, enabled]);
}
