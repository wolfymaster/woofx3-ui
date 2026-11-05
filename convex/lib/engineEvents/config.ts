/** Expired transient events deleted per sweep call; a full page sweeps again at once. */
export const TRANSIENT_SWEEP_BATCH = 500;

/**
 * How long an applied envelope id is remembered. Longer than the queue's
 * longest redelivery window (a lease plus every retry backoff, about 2 h) and
 * the engine's own retries, so a redelivery always finds its receipt.
 */
export const RECEIPT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/** Expired receipts deleted per cleanup call; a full page cleans again at once. */
export const RECEIPT_CLEANUP_BATCH = 500;
