import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type LimitValue, validateEntitlementInput, validatePlanKey } from "./entitlements";

/** Writes to plans, validated one way for every caller; `actor` names who made the change. */

export interface PlanInput {
  key: string;
  name: string;
  description?: string;
  features: string[];
  limits: LimitValue[];
  offered: boolean;
}

/** Creates a plan, or replaces the plan with that key. */
export async function upsertPlan(ctx: MutationCtx, input: PlanInput, actor: string): Promise<Id<"plans">> {
  validatePlanKey(input.key);
  if (input.name.trim() === "") {
    throw new Error("A plan needs a name");
  }
  validateEntitlementInput({ features: input.features, limits: input.limits });
  const fields = {
    key: input.key,
    name: input.name.trim(),
    description: input.description,
    features: [...new Set(input.features)].sort(),
    limits: input.limits,
    offered: input.offered,
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

/** Deletes a plan. Tier plans are read by key, so a missing row is a setup error elsewhere. */
export async function deletePlan(ctx: MutationCtx, key: string): Promise<void> {
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
