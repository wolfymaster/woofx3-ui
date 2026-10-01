import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { ENGINE_SYNC_CONFIG } from "./config";

/**
 * Give an instance its instanceSync row, which is what puts it on the sweep's
 * schedule. Called when the instance registers with its engine and again
 * before every run, so the sweep itself never has to look for instances
 * without one.
 */
export async function ensureSyncRow(ctx: MutationCtx, instanceId: Id<"instances">): Promise<Doc<"instanceSync">> {
  const existing = await ctx.db
    .query("instanceSync")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const id = await ctx.db.insert("instanceSync", {
    instanceId,
    lastSyncedAt: 0,
    nextEligibleAt: now,
    status: "idle",
    lastError: "",
    lastDurationMs: 0,
    consecutiveErrorCount: 0,
    syncIntervalMs: ENGINE_SYNC_CONFIG.defaultSyncIntervalMs,
  });
  const row = await ctx.db.get(id);
  if (!row) {
    throw new Error("ensureSyncRow: insert lost");
  }
  return row;
}
