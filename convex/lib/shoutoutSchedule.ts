/**
 * Timing rules for the shoutout queue, kept pure so they can be tested.
 *
 * The processor itself can only be exercised against Twitch, but its arithmetic
 * is where the damage lives: send too fast and Twitch rate-limits the channel,
 * retry a doomed entry too eagerly and it burns every slot. None of this is
 * observable until it misfires on a live stream, so it is tested here instead.
 */

/**
 * Twitch allows one shoutout per 2 minutes per broadcaster. The endpoint also
 * refuses a target shouted out within the last 60 minutes, and refuses when the
 * target is offline -- both surface as a failed attempt and are handled by
 * backing that entry off, not by pacing everything else differently.
 */
export const SHOUTOUT_COOLDOWN_MS = 120_000;

const RETRY_BASE_MS = 120_000;
const RETRY_MAX_MS = 900_000; // 15 minutes

/** An entry as the scheduling rules see it. */
export interface SchedulableEntry {
  sortOrder: number;
  nextEligibleAt: number;
}

/**
 * When the processor may next send, given the last successful send. Sending is
 * paced per channel, not per entry, so this ignores the queue entirely.
 */
export function nextSendAt(lastSentAt: number | undefined, now: number): number {
  if (lastSentAt === undefined) {
    return now;
  }
  return Math.max(now, lastSentAt + SHOUTOUT_COOLDOWN_MS);
}

/**
 * How long to hold an entry after a failed attempt, growing with each failure.
 *
 * Capped at 15 minutes rather than climbing indefinitely: the common failure is
 * a target who simply is not live yet, and an entry that has backed off to
 * hours would not fire for a long time after they came back. The queue keeps
 * retrying until the entry is removed by hand -- nothing here gives up.
 */
export function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

/**
 * The entry to attempt next: the earliest in queue order whose backoff has
 * elapsed. Entries still backing off are skipped rather than blocking the ones
 * behind them, so a single offline channel cannot stall the queue.
 *
 * Returns null when every entry is still waiting.
 */
export function pickNextEntry<T extends SchedulableEntry>(entries: readonly T[], now: number): T | null {
  let best: T | null = null;
  for (const entry of entries) {
    if (entry.nextEligibleAt > now) {
      continue;
    }
    if (best === null || entry.sortOrder < best.sortOrder) {
      best = entry;
    }
  }
  return best;
}

/**
 * When the processor should next wake, given a queue with nothing eligible yet:
 * the soonest moment any entry becomes eligible, or null if the queue is empty.
 */
export function earliestEligibleAt<T extends SchedulableEntry>(entries: readonly T[]): number | null {
  let soonest: number | null = null;
  for (const entry of entries) {
    if (soonest === null || entry.nextEligibleAt < soonest) {
      soonest = entry.nextEligibleAt;
    }
  }
  return soonest;
}
