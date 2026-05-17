/**
 * Central configuration for engine sync. Tune these values without
 * touching call sites. All durations are in milliseconds unless suffixed
 * with a different unit.
 */
export const ENGINE_SYNC_CONFIG = {
  /** Cron tick frequency. */
  sweepIntervalMinutes: 5,
  /** Default time between scheduled syncs for a new instance. */
  defaultSyncIntervalMs: 8 * 60 * 60 * 1000,
  /** Skip sync if the account has had no activity in this window. */
  inactivityThresholdMs: 24 * 60 * 60 * 1000,
  /** Max instances handled per sweep tick. */
  sweepBatchSize: 10,
  /** ± jitter applied to nextEligibleAt so instances don't re-align. */
  jitterMs: 5 * 60 * 1000,
  /** Page size for paginated engine reads. */
  pageSize: 100,
  /** After this many consecutive errors, cap backoff at maxBackoffMs. */
  maxConsecutiveErrors: 10,
  /** Exponential multiplier applied per consecutive error. */
  backoffMultiplier: 2,
  /** Upper bound on backoff. */
  maxBackoffMs: 24 * 60 * 60 * 1000,
  /** syncRuns rows older than this are eligible for cleanup. */
  runHistoryRetentionMs: 14 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Pure: returns a jittered nextEligibleAt for a successful sync.
 * Exported separately so tests can drive deterministic time/jitter.
 */
export function computeNextEligibleAt(
  now: number,
  syncIntervalMs: number,
  jitterMs: number,
  rand: () => number = Math.random
): number {
  const jitter = Math.floor((rand() * 2 - 1) * jitterMs);
  return now + syncIntervalMs + jitter;
}

/**
 * Pure: returns backoff delay in ms for a failure run.
 * Exponential by consecutiveErrorCount, capped at maxBackoffMs.
 */
export function computeBackoffMs(
  syncIntervalMs: number,
  consecutiveErrorCount: number,
  config: typeof ENGINE_SYNC_CONFIG = ENGINE_SYNC_CONFIG
): number {
  const multiplier = config.backoffMultiplier ** Math.min(consecutiveErrorCount, config.maxConsecutiveErrors);
  return Math.min(syncIntervalMs * multiplier, config.maxBackoffMs);
}

/**
 * Pure: full computation of nextEligibleAt for a failed sync.
 */
export function computeNextEligibleAtAfterError(
  now: number,
  syncIntervalMs: number,
  consecutiveErrorCount: number,
  config: typeof ENGINE_SYNC_CONFIG = ENGINE_SYNC_CONFIG,
  rand: () => number = Math.random
): number {
  const backoff = computeBackoffMs(syncIntervalMs, consecutiveErrorCount, config);
  const jitter = Math.floor((rand() * 2 - 1) * config.jitterMs);
  return now + backoff + jitter;
}
