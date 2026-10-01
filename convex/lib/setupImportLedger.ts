import type { MutationCtx } from "../_generated/server";

/**
 * Mark the imported item a workflow create was made for as created, when that
 * create's webhook echo arrives. The apply does this itself when the echo comes
 * in time; this covers the echo that arrives after it gave up waiting, which
 * would otherwise leave an engine workflow the import does not know about and
 * let importing the file again duplicate it. A no-op for every create that was
 * not an imported item.
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
}
