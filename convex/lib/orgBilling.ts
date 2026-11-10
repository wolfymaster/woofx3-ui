import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { lifecycleReasonValidator } from "./billingLifecycle";
import { type AccountPlanRow, limitValuesValidator, type SubscriptionSummary } from "./entitlements";
import { planTierValidator, subscriptionStateValidator } from "./organization";
import type { AppliedDiscount } from "./payments/provider";
import { subscriptionFor } from "./subscriptions";

// The management plane owns billing; Convex keeps the last projection it was
// pushed (`orgBilling`) and enforces from it. Nothing here calls the plane, so
// entitlements keep working while it is down.

/** The fields of a projection the plane pushes, minus the account (a string on the wire, an id once stored). */
export const orgBillingFields = {
  version: v.number(),
  tier: v.union(planTierValidator, v.null()),
  addOns: v.array(v.string()),
  standing: subscriptionStateValidator,
  reason: v.union(lifecycleReasonValidator, v.null()),
  trialEndsAt: v.union(v.number(), v.null()),
  graceEndsAt: v.union(v.number(), v.null()),
  periodEnd: v.union(v.number(), v.null()),
  discountLabel: v.union(v.string(), v.null()),
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

/**
 * What the gates read about an org's billing, whichever record holds it.
 * `summary` is null when no plan applies (a projection with no tier).
 */
export interface BillingView {
  summary: SubscriptionSummary | null;
  addOns: readonly string[];
  spinDownAt: number | null;
  hasProviderSubscription: boolean;
  discount: AppliedDiscount | null;
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

/** The standing's date as the subscription row keeps it: the trial end while trialing, else the period end. */
export function projectionSummary(row: Doc<"orgBilling">): SubscriptionSummary | null {
  if (row.tier === null) {
    return null;
  }
  return {
    plan: row.tier,
    interval: null,
    state: row.standing,
    stateReason: row.reason,
    nextBillingAt: row.standing === "trialing" ? row.trialEndsAt : row.periodEnd,
    graceEndsAt: row.graceEndsAt,
    exemptUntil: null,
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
      spinDownAt: null,
      hasProviderSubscription: false,
      discount: null,
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
