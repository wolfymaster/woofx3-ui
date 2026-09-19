/**
 * Exponential backoff with equal jitter, for retrying a dropped connection.
 *
 * Kept as plain logic rather than living inside the transport so the schedule
 * can be tested without a socket: the transport's own reconnect path can only
 * be exercised against a real engine, but the delays it picks are the part most
 * likely to be wrong, and a mistake there is a reconnect storm.
 *
 * Equal jitter — half the capped delay plus a random half — rather than full
 * jitter, which can return near-zero and let every open tab retry at once the
 * moment an engine restarts.
 */
export interface ReconnectBackoff {
  /** The delay before the next attempt, in ms. Advances the sequence. */
  next(): number;
  /** Return to the first delay. Call once a connection is proven working. */
  reset(): void;
  /** Delays handed out since the last reset. */
  readonly attempts: number;
}

export interface ReconnectBackoffOptions {
  /** Delay for the first retry, before jitter. */
  baseMs?: number;
  /** Ceiling for the exponential growth, before jitter. */
  maxMs?: number;
  /** Injectable for tests; expected to return [0, 1). */
  random?: () => number;
}

const DEFAULT_BASE_MS = 1_000;
const DEFAULT_MAX_MS = 30_000;

export function createReconnectBackoff(options: ReconnectBackoffOptions = {}): ReconnectBackoff {
  const baseMs = options.baseMs ?? DEFAULT_BASE_MS;
  const maxMs = options.maxMs ?? DEFAULT_MAX_MS;
  const random = options.random ?? Math.random;

  let attempts = 0;

  return {
    next(): number {
      // 2 ** attempts rather than a running multiply: the cap applies to the
      // ideal delay, so a long outage cannot drift past maxMs through rounding.
      const ideal = Math.min(baseMs * 2 ** attempts, maxMs);
      attempts += 1;
      const half = ideal / 2;
      return Math.round(half + random() * half);
    },
    reset(): void {
      attempts = 0;
    },
    get attempts(): number {
      return attempts;
    },
  };
}
