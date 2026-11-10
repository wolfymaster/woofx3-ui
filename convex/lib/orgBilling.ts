import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { type AccountPlanRow, limitValuesValidator, type SubscriptionSummary } from "./entitlements";
import {
  billingIntervalValidator,
  lifecycleReasonValidator,
  planTierValidator,
  subscriptionStateValidator,
} from "./organization";

// The management plane owns billing; Convex keeps the last projection it was
// pushed (`orgBilling`) and enforces from it. Nothing here calls the plane, so
// entitlements keep working while it is down.

/** What the portal shows of a projected discount; the plane owns the discount, so Convex keeps only its label. */
export const projectedDiscountValidator = v.object({ label: v.string() });
export type ProjectedDiscount = Infer<typeof projectedDiscountValidator>;

/**
 * The fields of a projection the plane pushes, minus the account (a string on
 * the wire, an id once stored). The ops route rejects unknown fields, so Convex
 * must learn a field here before the plane starts sending it.
 */
export const orgBillingFields = {
  version: v.number(),
  tier: v.union(planTierValidator, v.null()),
  addOns: v.array(v.string()),
  standing: subscriptionStateValidator,
  reason: v.union(lifecycleReasonValidator, v.null()),
  trialEndsAt: v.union(v.number(), v.null()),
  graceEndsAt: v.union(v.number(), v.null()),
  periodEnd: v.union(v.number(), v.null()),
  interval: v.union(billingIntervalValidator, v.null()),
  exemptUntil: v.union(v.number(), v.null()),
  spinDownAt: v.union(v.number(), v.null()),
  hasProviderSubscription: v.boolean(),
  discount: v.union(projectedDiscountValidator, v.null()),
  overrides: v.object({
    addFeatures: v.array(v.string()),
    removeFeatures: v.array(v.string()),
    limits: limitValuesValidator,
  }),
};

export async function orgBillingFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"orgBilling"> | null> {
  return ctx.db
    .query("orgBilling")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
}

/** What the gates read about an org's billing, whichever record holds it. */
export interface BillingView {
  summary: SubscriptionSummary;
  addOns: readonly string[];
  spinDownAt: number | null;
  hasProviderSubscription: boolean;
  discount: ProjectedDiscount | null;
  overrides: AccountPlanRow;
}

/**
 * A projection with no tier keeps its standing, reason and dates, so a
 * suspended one still locks the dashboard and a trialing one still prompts.
 * `plan` is null: usability follows the standing alone, but no plan or add-on
 * feature is granted and the org gets no seat limit unless it has a managed
 * engine (see orgSeatLimit).
 */
export function projectionSummary(row: Doc<"orgBilling">): SubscriptionSummary {
  return {
    plan: row.tier,
    interval: row.interval,
    state: row.standing,
    stateReason: row.reason,
    nextBillingAt: row.standing === "trialing" ? row.trialEndsAt : row.periodEnd,
    graceEndsAt: row.graceEndsAt,
    exemptUntil: row.exemptUntil,
  };
}

/**
 * The org's billing: its projection once the plane has pushed one, which is
 * then authoritative. An org with no projection row yet returns null and
 * behaves as an org with no subscription did before billing existed: its
 * gates stay open (callers check for null before requiring a usable standing)
 * and its entitlements come from its operator assignment or the default plan.
 */
export async function billingFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<BillingView | null> {
  const projection = await orgBillingFor(ctx, accountId);
  if (projection === null) {
    return null;
  }
  return {
    summary: projectionSummary(projection),
    addOns: projection.addOns,
    spinDownAt: projection.spinDownAt,
    hasProviderSubscription: projection.hasProviderSubscription,
    discount: projection.discount,
    overrides: projection.overrides,
  };
}
