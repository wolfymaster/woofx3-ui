import type { MutationCtx } from "../_generated/server";

/**
 * Mark the starter pack item a workflow create was made for as installed, when
 * that create's webhook echo arrives. The install action does this itself when
 * the echo comes in time; this covers the echo that arrives after it gave up
 * waiting, which would otherwise leave an engine workflow the ledger does not
 * know about and let a second install duplicate it. A no-op for every create
 * that was not a starter pack item.
 */
export async function completeStarterItemByCorrelation(
  ctx: MutationCtx,
  correlationKey: string,
  engineWorkflowId: string
): Promise<void> {
  const row = await ctx.db
    .query("starterPackItems")
    .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
    .first();
  if (!row || row.status === "installed") {
    return;
  }
  await ctx.db.patch(row._id, { status: "installed", engineId: engineWorkflowId });
}
