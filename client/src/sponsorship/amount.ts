import type { SponsorshipInterval, SponsorshipTerms } from "@convex/lib/billingClient";
import { formatCents } from "@/billing/format";

export const DEFAULT_SPONSORSHIP: { amountCents: number; interval: SponsorshipInterval } = {
  amountCents: 25_000,
  interval: "month",
};

/** Whole dollars or dollars and cents, as a person types them: "250", "250.5", "$1,000.00". Null when it is neither. */
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Math.round(Number(cleaned) * 100);
}

/** The text an amount field starts with: "250", or "250.50" when there are cents. */
export function dollarsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** What is wrong with an amount, in words for the field; null when the plane's terms accept it. */
export function amountProblem(cents: number | null, terms: SponsorshipTerms): string | null {
  if (cents === null) {
    return "Enter an amount in dollars, like 250 or 250.50.";
  }
  if (cents < terms.minCents) {
    return `The minimum is ${formatCents(terms.minCents)}.`;
  }
  if (cents > terms.maxCents) {
    return `The maximum is ${formatCents(terms.maxCents)}.`;
  }
  return null;
}

export interface SponsorshipChoice {
  amountCents: number;
  interval: SponsorshipInterval;
}

/**
 * What the address suggests the sponsor wants. Both values only prefill the form: a missing or malformed one falls
 * back to the default, and the terms are checked on the form, never here.
 */
export function prefillFromSearch(search: string): SponsorshipChoice {
  const params = new URLSearchParams(search);
  const rawAmount = params.get("amountCents");
  const amount = rawAmount !== null && /^\d{1,12}$/.test(rawAmount) ? Number(rawAmount) : 0;
  const interval = params.get("interval");
  return {
    amountCents: amount > 0 ? amount : DEFAULT_SPONSORSHIP.amountCents,
    interval: interval === "month" || interval === "once" ? interval : DEFAULT_SPONSORSHIP.interval,
  };
}
