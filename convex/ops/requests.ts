import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { OPS_REQUESTS } from "../lib/ops/idempotency";

/**
 * Deletes idempotency keys older than `OPS_REQUESTS.retentionMs`. Runs on a
 * daily cron (see crons.ts) and continues while a batch comes back full, at
 * most `OPS_REQUESTS.maxCleanupPasses` passes; the next day's run takes the rest.
 */
export const cleanupOld = internalMutation({
  args: { passesLeft: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const passesLeft = args.passesLeft ?? OPS_REQUESTS.maxCleanupPasses;
    const old = await ctx.db
      .query("opsRequests")
      .withIndex("by_claimed_at", (q) => q.lt("claimedAt", Date.now() - OPS_REQUESTS.retentionMs))
      .take(OPS_REQUESTS.cleanupBatch);
    for (const row of old) {
      await ctx.db.delete(row._id);
    }
    if (old.length === OPS_REQUESTS.cleanupBatch && passesLeft > 1) {
      await ctx.scheduler.runAfter(0, internal.ops.requests.cleanupOld, { passesLeft: passesLeft - 1 });
    }
    return old.length;
  },
});
