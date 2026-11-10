import type { SubscriptionState } from "./organization";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The banner opens this many days before the trial ends. */
export const TRIAL_BANNER_DAYS = 7;

export type BannerKind = "trial_ending" | "payment_needed";

export interface BillingBanner {
  kind: BannerKind;
  /** When the trial ends, or when an unpaid org is suspended. */
  dateIso: string;
}

/**
 * The billing banner a hosted engine shows: in the last days of a trial, and
 * while past due. Nothing otherwise, including while exempt.
 */
export function billingBanner(
  subscription: { state: SubscriptionState; nextBillingAt: number | null; graceEndsAt: number | null } | null,
  now: number
): BillingBanner | null {
  if (subscription === null) {
    return null;
  }
  if (subscription.state === "trialing" && subscription.nextBillingAt !== null) {
    const opensAt = subscription.nextBillingAt - TRIAL_BANNER_DAYS * DAY_MS;
    return now >= opensAt
      ? { kind: "trial_ending", dateIso: new Date(subscription.nextBillingAt).toISOString() }
      : null;
  }
  if (subscription.state === "past_due" && subscription.graceEndsAt !== null) {
    return { kind: "payment_needed", dateIso: new Date(subscription.graceEndsAt).toISOString() };
  }
  return null;
}
