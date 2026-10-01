/** How long an action waits for the engine's webhook echo before giving up. */
export const CORRELATION_TIMEOUT_MS = 10_000;

const FIRST_POLL_DELAY_MS = 150;
const MAX_POLL_DELAY_MS = 2_000;

/**
 * Delay before the next look for a webhook echo, after `pollsSoFar` looks found
 * nothing. Doubles from a short first wait: an echo usually lands within a few
 * hundred milliseconds, so early looks stay frequent, while one that is late
 * costs a handful of reads rather than one every quarter second. Each look is a
 * billed function call.
 */
export function nextPollDelayMs(pollsSoFar: number): number {
  if (!Number.isInteger(pollsSoFar) || pollsSoFar < 1) {
    throw new Error(`nextPollDelayMs: pollsSoFar must be a positive integer, got ${pollsSoFar}`);
  }
  return Math.min(FIRST_POLL_DELAY_MS * 2 ** (pollsSoFar - 1), MAX_POLL_DELAY_MS);
}
