import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { ENTITLEMENT_CATALOG, limitValuesValidator } from "./lib/entitlements";
import { clearAccountPlan, deletePlan, setAccountPlan, setDefaultPlan, upsertPlan } from "./lib/plans";

/**
 * Operator commands for plans and account assignments, run from the CLI
 * until the backoffice edits them. `actor` defaults to "cli".
 *
 *   bunx convex run plans:list
 *   bunx convex run plans:upsert '{"key": "pro", "name": "Pro", "features": [], "limits": [], "offered": true}'
 *   bunx convex run plans:setDefault '{"key": "free"}'
 *   bunx convex run plans:setAccount '{"accountId": "…", "planKey": "pro", "addFeatures": [], "removeFeatures": [], "limits": []}'
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
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    features: v.array(v.string()),
    limits: limitValuesValidator,
    offered: v.boolean(),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { actor, ...input }) => {
    return upsertPlan(ctx, input, actor ?? CLI);
  },
});

export const setDefault = internalMutation({
  args: { key: v.string(), actor: v.optional(v.string()) },
  handler: async (ctx, { key, actor }) => {
    await setDefaultPlan(ctx, key, actor ?? CLI);
  },
});

export const remove = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await deletePlan(ctx, key);
  },
});

export const setAccount = internalMutation({
  args: {
    accountId: v.id("accounts"),
    planKey: v.union(v.string(), v.null()),
    addFeatures: v.array(v.string()),
    removeFeatures: v.array(v.string()),
    limits: limitValuesValidator,
    expiresAt: v.optional(v.number()),
    actor: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, actor, ...input }) => {
    await setAccountPlan(ctx, accountId, input, actor ?? CLI);
  },
});

export const clearAccount = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await clearAccountPlan(ctx, accountId);
  },
});
