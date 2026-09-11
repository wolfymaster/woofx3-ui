/**
 * A shared "at most once per window, per key" claim.
 *
 * Convex dedupes queries for you: N components subscribing to the same query
 * is one subscription. Actions have no such protection — each caller is its
 * own round trip — so when several components independently want to freshen
 * the same server-side fact on mount, they need to agree on who actually
 * makes the call. This is that agreement, kept as plain logic so it can be
 * tested without a React renderer.
 */
export interface PollThrottle {
  /**
   * Returns true for the caller that may perform the call, false for everyone
   * else inside the window. Claiming marks the window immediately, so callers
   * racing within the same tick don't all get through.
   */
  claim(key: string, now?: number): boolean;
  reset(): void;
}

export function createPollThrottle(windowMs: number): PollThrottle {
  const claimedAt = new Map<string, number>();

  return {
    claim(key: string, now = Date.now()): boolean {
      const last = claimedAt.get(key);
      if (last !== undefined && now - last < windowMs) {
        return false;
      }
      claimedAt.set(key, now);
      return true;
    },
    reset(): void {
      claimedAt.clear();
    },
  };
}
