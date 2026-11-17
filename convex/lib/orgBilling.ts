import { type Infer, v } from "convex/values";
import { limitValuesValidator } from "./entitlements";
import {
  billingIntervalValidator,
  lifecycleReasonValidator,
  planTierValidator,
  subscriptionStateValidator,
} from "./organization";

// The billing projection as the management plane pushes it. The app reads it
// only through `convex/org/billing.ts`.

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
