import type { AppliedDiscount, DiscountDuration, PlanPrice } from "@convex/lib/billingClient";
import type { BillingInterval, PlanTier } from "@convex/lib/organization";
import type { MyOrganization } from "@convex/organizations";

const INTERVAL_SUFFIX: Record<BillingInterval, string> = { month: "/mo", year: "/yr" };

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export const PRICE_UNAVAILABLE_TEXT = "price unavailable";

/** The plane's price for the plan and interval, as "$60/mo"; `prices` is null while the plane has not answered. */
export function formatPrice(prices: readonly PlanPrice[] | null, plan: PlanTier, interval: BillingInterval): string {
  const price = prices?.find((candidate) => candidate.plan === plan && candidate.interval === interval);
  if (price === undefined) {
    return PRICE_UNAVAILABLE_TEXT;
  }
  return `${formatCents(price.amountCents).replace(/\.00$/, "")}${INTERVAL_SUFFIX[interval]}`;
}

/** A plan's display name from the plan rows, or its key while they have not loaded. */
export function planName(names: Readonly<Record<string, string>>, plan: PlanTier): string {
  return names[plan] ?? plan;
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

/** "3 of 5 seats used", or "20 members" when no seat limit applies. */
export function formatSeats(seats: NonNullable<MyOrganization["seats"]>): string {
  if (seats.limit === null) {
    return seats.used === 1 ? "1 member" : `${seats.used} members`;
  }
  return `${seats.used} of ${seats.limit} seats used`;
}
