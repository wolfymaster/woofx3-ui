import { useEffect, useRef } from "react";
import { $documentVisible } from "@/lib/stores";
import { startVisibleInterval } from "@/lib/visible-interval";

/**
 * `setInterval` that stops while the tab is hidden and fires immediately when it
 * becomes visible again. Background tabs are throttled, not stopped, so a plain
 * interval keeps paying for requests nobody will see.
 *
 * The latest `callback` is always the one called; a new callback identity does
 * not restart the cadence. Pass `enabled = false` to stop it entirely.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return startVisibleInterval(() => callbackRef.current(), ms, $documentVisible);
  }, [ms, enabled]);
}
