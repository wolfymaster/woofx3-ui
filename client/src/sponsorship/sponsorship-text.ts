import type { Sponsorship, SponsorshipInterval, SponsorshipState } from "@convex/lib/billingClient";
import { formatCents, formatDay } from "@/billing/format";

export const SPONSOR_START_PATH = "/sponsor/start";

export const INTERVAL_LABELS: Record<SponsorshipInterval, string> = { month: "Monthly", once: "One-time" };

export const STATE_LABELS: Record<SponsorshipState, string> = {
  pending: "Waiting for payment",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Canceled",
  complete: "Paid",
};

/** "$250/mo" for a monthly sponsorship, "$250 once" for a one-time one. */
export function amountSummary(sponsorship: Pick<Sponsorship, "amountCents" | "interval">): string {
  const amount = formatCents(sponsorship.amountCents).replace(/\.00$/, "");
  return sponsorship.interval === "month" ? `${amount}/mo` : `${amount} once`;
}

/** The payment-history line for a payment of this sponsorship. */
export function paymentDescription(sponsorship: Pick<Sponsorship, "interval">): string {
  return sponsorship.interval === "month" ? "Monthly sponsorship" : "One-time sponsorship";
}

/** A monthly sponsorship the sponsor can still change, cancel or fix the card of. */
export function isManageable(sponsorship: Sponsorship): boolean {
  return (
    sponsorship.interval === "month" &&
    !sponsorship.cancelAtPeriodEnd &&
    (sponsorship.state === "active" || sponsorship.state === "past_due")
  );
}

/** The one-line notice under a sponsorship's summary; null when there is nothing to say. */
export function sponsorshipNotice(sponsorship: Sponsorship): { tone: "warning" | "info"; text: string } | null {
  if (sponsorship.state === "past_due") {
    return {
      tone: "warning",
      text: "Your last payment didn't go through. Update your payment method to keep sponsoring.",
    };
  }
  if (sponsorship.cancelAtPeriodEnd && sponsorship.currentPeriodEnd !== null) {
    return { tone: "info", text: `Canceled. Your sponsorship ends on ${formatDay(sponsorship.currentPeriodEnd)}.` };
  }
  return null;
}
