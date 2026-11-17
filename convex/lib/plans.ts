import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type LimitValue, validateEntitlementInput } from "./entitlements";
import { PLAN_TIERS, type PlanTier } from "./organization";

/** Writes to plans, validated one way for every caller; `actor` names who made the change. */

export interface PlanInput {
  key: PlanTier;
  name: string;
  features: string[];
  limits: LimitValue[];
}

/** Creates a plan, or replaces the plan with that key. */
export async function upsertPlan(ctx: MutationCtx, input: PlanInput, actor: string): Promise<Id<"plans">> {
  if (input.name.trim() === "") {
    throw new Error("A plan needs a name");
  }
  validateEntitlementInput({ features: input.features, limits: input.limits });
  const fields = {
    key: input.key,
    name: input.name.trim(),
    features: [...new Set(input.features)].sort(),
    limits: input.limits,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  const existing = await planByKey(ctx, input.key);
  if (existing) {
    await ctx.db.replace(existing._id, fields);
    return existing._id;
  }
  return ctx.db.insert("plans", fields);
}

/** Deletes a plan. Tier plans are read by key for every org of that tier, so those rows are never deleted. */
export async function deletePlan(ctx: MutationCtx, key: string): Promise<void> {
  if ((PLAN_TIERS as readonly string[]).includes(key)) {
    throw new Error(`Plan "${key}" is a tier plan; replace it with plans:upsert instead of deleting it`);
  }
  const plan = await planByKey(ctx, key);
  if (!plan) {
    throw new Error(`No plan "${key}"`);
  }
  await ctx.db.delete(plan._id);
}

export async function planByKey(ctx: MutationCtx, key: string) {
  return ctx.db
    .query("plans")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
