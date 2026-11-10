import { type Infer, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { lifecycleReasonValidator } from "./billingLifecycle";
import { type AccountPlanRow, limitValuesValidator, type SubscriptionSummary } from "./entitlements";
import { billingIntervalValidator, planTierValidator, subscriptionStateValidator } from "./organization";
import type { AppliedDiscount } from "./payments/provider";
import { subscriptionFor } from "./subscriptions";

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
  discount: AppliedDiscount | ProjectedDiscount | null;
  /** A projection's own overrides; a subscription has none here (`accountPlans` applies instead). */
  overrides: AccountPlanRow | null;
}

export function subscriptionSummary(row: Doc<"subscriptions">): SubscriptionSummary {
  return {
    plan: row.plan,
    interval: row.interval ?? null,
    state: row.state,
    stateReason: row.stateReason ?? null,
    nextBillingAt: row.nextBillingAt ?? null,
    graceEndsAt: row.graceEndsAt ?? null,
    exemptUntil: row.exemptUntil ?? null,
  };
}

/**
 * The standing's date as the subscription row keeps it: the trial end while
 * trialing, else the period end.
 *
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
 * The org's billing: its projection when the plane has pushed one, which is
 * then authoritative, else its subscription row, else null. An org with
 * neither is gated as it was before billing existed.
 */
export async function billingFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<BillingView | null> {
  const projection = await orgBillingFor(ctx, accountId);
  if (projection !== null) {
    return {
      summary: projectionSummary(projection),
      addOns: projection.addOns,
      spinDownAt: projection.spinDownAt,
      hasProviderSubscription: projection.hasProviderSubscription,
      discount: projection.discount,
      overrides: projection.overrides,
    };
  }
  const row = await subscriptionFor(ctx, accountId);
  if (row === null) {
    return null;
  }
  return {
    summary: subscriptionSummary(row),
    addOns: row.addOns,
    spinDownAt: row.spinDownAt ?? null,
    hasProviderSubscription: row.providerSubscriptionId !== undefined,
    discount: row.discount ?? null,
    overrides: null,
  };
}
