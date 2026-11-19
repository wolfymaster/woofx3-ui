import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { accountEntitlements } from "../lib/entitlementAccess";

export type ManagedEngineLimitRefusal = {
  code: "managed_engine_limit";
  limit: number;
  current: number;
  message: string;
};

/**
 * Throws `managed_engine_limit` when the org already has as many managed
 * engines as its plan allows. `building` is the instance the request is for,
 * which does not count against itself. Deleted engines and self-hosted
 * engines are not counted. An org with no projection resolves to the code default, so
 * it may make its first engine only.
 */
export async function assertManagedEngineRoom(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  building: Id<"instances">
): Promise<void> {
  const limit = (await accountEntitlements(ctx, accountId)).limits["org.managedEngines"];
  if (limit === undefined) {
    throw new Error('Limit "org.managedEngines" was not resolved');
  }
  if (limit === null) {
    return;
  }
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  let current = 0;
  for (const instance of instances) {
    if (instance.hosting !== "managed" || instance._id === building) {
      continue;
    }
    const provisioning = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (q) => q.eq("instanceId", instance._id))
      .first();
    if (provisioning?.status !== "deleted") {
      current += 1;
    }
  }
  if (current >= limit) {
    throw new ConvexError<ManagedEngineLimitRefusal>({
      code: "managed_engine_limit",
      limit,
      current,
      message: `Your plan includes ${limit} hosted ${limit === 1 ? "engine" : "engines"}. Upgrade your plan in Billing to create another.`,
    });
  }
}
