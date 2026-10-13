import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { GRANT_PUSH_LEASE_MS, isGrantSigningConfigured } from "./entitlementGrant";

/**
 * Pushes a fresh grant to the instance's engine now, creating its grant row
 * the first time. The row is leased so the renewal sweep does not push it
 * again while this push runs.
 */
export async function scheduleGrantPush(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  if (!isGrantSigningConfigured()) {
    return;
  }
  const now = Date.now();
  const row = await ctx.db
    .query("entitlementGrants")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, { renewAt: now + GRANT_PUSH_LEASE_MS });
  } else {
    await ctx.db.insert("entitlementGrants", {
      instanceId,
      seq: 0,
      grants: [],
      renewAt: now + GRANT_PUSH_LEASE_MS,
    });
  }
  await ctx.scheduler.runAfter(0, internal.entitlementGrantActions.push, { instanceId });
}
