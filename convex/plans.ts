import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { ENTITLEMENT_CATALOG, limitValuesValidator } from "./lib/entitlements";
import { planTierValidator } from "./lib/organization";
import { deletePlan, upsertPlan } from "./lib/plans";

/**
 * Operator commands for the tier plan rows, run from the CLI. `actor` defaults to "cli".
 *
 *   bunx convex run plans:list
 *   bunx convex run plans:upsert '{"key": "pro", "name": "Pro", "features": [], "limits": []}'
 */

const CLI = "cli";

/** Every plan, and the features and limits code knows. */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const plans = await ctx.db.query("plans").take(200);
    return { plans, catalog: ENTITLEMENT_CATALOG };
  },
});

export const upsert = internalMutation({
  args: {
    key: planTierValidator,
    name: v.string(),
    features: v.array(v.string()),
    limits: limitValuesValidator,
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { actor, ...input }) => {
    return upsertPlan(ctx, input, actor ?? CLI);
  },
});

export const remove = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await deletePlan(ctx, key);
  },
});
