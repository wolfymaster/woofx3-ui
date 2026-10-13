import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type LimitValue, validateEntitlementInput, validatePlanKey } from "./entitlements";

/**
 * Writes to plans and account assignments. The CLI and the ops API both go
 * through these, so every path validates the same way; `actor` names who
 * made the change.
 */

export interface PlanInput {
  key: string;
  name: string;
  description?: string;
  features: string[];
  limits: LimitValue[];
  offered: boolean;
}

/** Creates a plan, or replaces the plan with that key. Whether it is the default does not change here. */
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
    await ctx.db.replace(existing._id, { ...fields, isDefault: existing.isDefault });
    return existing._id;
  }
  return ctx.db.insert("plans", { ...fields, isDefault: false });
}

/** Makes a plan the one accounts without an assignment are on. */
export async function setDefaultPlan(ctx: MutationCtx, key: string, actor: string): Promise<void> {
  const plan = await planByKey(ctx, key);
  if (!plan) {
    throw new Error(`No plan "${key}"`);
  }
  const current = await ctx.db
    .query("plans")
    .withIndex("by_default", (q) => q.eq("isDefault", true))
    .collect();
  const now = Date.now();
  for (const other of current) {
    if (other._id !== plan._id) {
      await ctx.db.patch(other._id, { isDefault: false, updatedAt: now, updatedBy: actor });
    }
  }
  await ctx.db.patch(plan._id, { isDefault: true, updatedAt: now, updatedBy: actor });
}

/** Deletes a plan no account is on and that is not the default. */
export async function deletePlan(ctx: MutationCtx, key: string): Promise<void> {
  const plan = await planByKey(ctx, key);
  if (!plan) {
    throw new Error(`No plan "${key}"`);
  }
  if (plan.isDefault) {
    throw new Error(`"${key}" is the default plan; make another plan the default first`);
  }
  const onIt = await ctx.db
    .query("accountPlans")
    .withIndex("by_plan", (q) => q.eq("planId", plan._id))
    .first();
  if (onIt) {
    throw new Error(`Accounts are on "${key}"; move them to another plan first`);
  }
  await ctx.db.delete(plan._id);
}

export interface AccountPlanInput {
  /** Null: the default plan. */
  planKey: string | null;
  addFeatures: string[];
  removeFeatures: string[];
  limits: LimitValue[];
  expiresAt?: number;
}

/** Sets an account's plan and its overrides, replacing any it had. */
export async function setAccountPlan(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  input: AccountPlanInput,
  actor: string
): Promise<void> {
  if (!(await ctx.db.get(accountId))) {
    throw new Error(`No account ${accountId}`);
  }
  validateEntitlementInput({ features: input.addFeatures, removeFeatures: input.removeFeatures, limits: input.limits });
  if (input.expiresAt !== undefined && input.expiresAt <= Date.now()) {
    throw new Error("expiresAt is in the past");
  }
  let planId: Id<"plans"> | undefined;
  if (input.planKey !== null) {
    const plan = await planByKey(ctx, input.planKey);
    if (!plan) {
      throw new Error(`No plan "${input.planKey}"`);
    }
    planId = plan._id;
  }
  const fields = {
    accountId,
    planId,
    addFeatures: [...new Set(input.addFeatures)].sort(),
    removeFeatures: [...new Set(input.removeFeatures)].sort(),
    limits: input.limits,
    expiresAt: input.expiresAt,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  const existing = await ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  if (existing) {
    await ctx.db.replace(existing._id, fields);
  } else {
    await ctx.db.insert("accountPlans", fields);
  }
}

/** Puts an account back on the default plan with no overrides. */
export async function clearAccountPlan(ctx: MutationCtx, accountId: Id<"accounts">): Promise<void> {
  const existing = await ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

async function planByKey(ctx: MutationCtx, key: string) {
  return ctx.db
    .query("plans")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
