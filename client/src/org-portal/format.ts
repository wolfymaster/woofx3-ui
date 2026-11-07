import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { AppliedDiscount, DiscountDuration } from "@convex/lib/payments/provider";

export const PLAN_NAMES: Record<PlanTier, string> = { starter: "Starter", pro: "Pro" };

/**
 * List prices in cents, for choosing a plan. Stripe holds the prices that are
 * charged; these must match its `woofx3_<tier>_<interval>` prices and the
 * marketing pricing page (woofx3-marketing `client/src/content/pricing.ts`).
 */
export const PLAN_PRICE_CENTS: Record<PlanTier, Record<BillingInterval, number>> = {
  starter: { month: 6000, year: 60000 },
  pro: { month: 12000, year: 120000 },
};

const INTERVAL_SUFFIX: Record<BillingInterval, string> = { month: "/mo", year: "/yr" };

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function formatPrice(plan: PlanTier, interval: BillingInterval): string {
  const cents = PLAN_PRICE_CENTS[plan][interval];
  return `${formatCents(cents).replace(/\.00$/, "")}${INTERVAL_SUFFIX[interval]}`;
}

function durationText(duration: DiscountDuration): string {
  switch (duration.kind) {
    case "once":
      return "on the next payment";
    case "months":
      return duration.months === 1 ? "for 1 month" : `for ${duration.months} months`;
    case "forever":
      return "on every payment";
  }
}

/** "50% off for 3 months", "$10.00 off on the next payment". */
export function describeDiscount(discount: AppliedDiscount): string {
  const { spec } = discount;
  const amount = spec.kind === "percent_off" ? `${spec.percent}%` : formatCents(spec.amountCents);
  return `${amount} off ${durationText(spec.duration)}`;
}
