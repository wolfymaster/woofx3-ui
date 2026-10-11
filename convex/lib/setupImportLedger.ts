import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

/**
 * Whether an imported workflow should be on: as it was in the source setup.
 * Every workflow item's spec carries `enabled` (ImportWorkflowSpec), so a spec
 * without one is a broken row, not a default.
 */
export function importedWorkflowEnabled(spec: unknown): boolean {
  const enabled = spec && typeof spec === "object" ? (spec as { enabled?: unknown }).enabled : undefined;
  if (typeof enabled !== "boolean") {
    throw new Error("An imported workflow's spec has no enabled state");
  }
  return enabled;
}

/**
 * Mark the imported item a workflow create was made for as created, when that
 * create's webhook echo arrives. The apply does this itself when the echo comes
 * in time; this covers the echo that arrives after it gave up waiting, which
 * would otherwise leave an engine workflow the import does not know about and
 * let importing the file again duplicate it. A no-op for every create that was
 * not an imported item.
 *
 * It also gives the workflow the enabled state it had in the source setup.
 * The engine creates every workflow off, and the streamer expects what they
 * had running before to keep running.
 */
export async function completeImportItemByCorrelation(
  ctx: MutationCtx,
  correlationKey: string,
  engineWorkflowId: string
): Promise<void> {
  const row = await ctx.db
    .query("setupImportItems")
    .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
    .first();
  if (!row || row.outcome === "created") {
    return;
  }
  await ctx.db.patch(row._id, { outcome: "created", engineId: engineWorkflowId, message: undefined });
  await ctx.scheduler.runAfter(0, internal.workflowActions.applyEnabledAfterCreate, {
    instanceId: row.instanceId,
    engineWorkflowId,
    isEnabled: importedWorkflowEnabled(row.spec),
  });
}
