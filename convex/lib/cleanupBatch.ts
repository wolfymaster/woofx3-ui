import { v } from "convex/values";

/**
 * Optional `batchSize` argument of the self-rescheduling cleanups. A cron
 * starts a chain without it and each pass hands it on unchanged; tests pass a
 * small one so a long chain stays fast.
 */
export const cleanupBatchSizeArg = v.optional(v.number());

/**
 * The batch size a cleanup pass uses. A chain ends only when a batch comes
 * back short, so a size below one would never end it and is refused.
 */
export function cleanupBatchSize(requested: number | undefined, fallback: number): number {
  const size = requested ?? fallback;
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`cleanup batch size must be a positive integer, got ${size}`);
  }
  return size;
}
