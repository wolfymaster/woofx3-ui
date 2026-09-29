import { atom, onMount, type ReadableAtom } from "nanostores";

/**
 * A clock store that ticks only while something is subscribed.
 *
 * Every live-uptime readout on the page reads the same store, so the page
 * runs one interval no matter how many readouts are mounted, and none at all
 * once the last one unmounts (nanostores unmounts a store shortly after its
 * final listener leaves). Components render the clock from a leaf so each
 * tick commits only the text that changed, not the subtree around it.
 */
export function createTicker(intervalMs: number, readClock: () => number = Date.now): ReadableAtom<number> {
  if (!(Number.isFinite(intervalMs) && intervalMs > 0)) {
    throw new Error(`createTicker: intervalMs must be a positive number, got ${intervalMs}`);
  }
  const $now = atom(readClock());
  onMount($now, () => {
    // The store may have sat unmounted for a while; don't render a stale value
    // for the first interval.
    $now.set(readClock());
    const interval = setInterval(() => $now.set(readClock()), intervalMs);
    return () => clearInterval(interval);
  });
  return $now;
}

export const $nowPerSecond = createTicker(1000);
