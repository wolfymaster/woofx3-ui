import type { BillingInterval, SubscriptionState } from "@convex/lib/organization";
import type { OrgSubscription } from "@convex/organizations";
import { formatDay, PLAN_NAMES } from "./format";

const STATE_LABELS: Record<SubscriptionState, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Payment needed",
  suspended: "Suspended",
  exempt: "Complimentary",
};

const INTERVAL_LABELS: Record<BillingInterval, string> = { month: "monthly", year: "yearly" };

/** "Starter, monthly"; just the plan before a provider subscription sets the interval; "No plan" when none applies. */
export function planLabel(subscription: OrgSubscription): string {
  if (subscription.plan === null) {
    return "No plan";
  }
  const name = PLAN_NAMES[subscription.plan];
  return subscription.interval === null ? name : `${name}, ${INTERVAL_LABELS[subscription.interval]}`;
}

/** "Trial, ends 4 Dec 2026". */
export function stateLabel(subscription: OrgSubscription): string {
  const label = STATE_LABELS[subscription.state];
  switch (subscription.state) {
    case "trialing":
      return subscription.nextBillingAt === null ? label : `${label}, ends ${formatDay(subscription.nextBillingAt)}`;
    case "past_due":
      return subscription.graceEndsAt === null ? label : `${label} by ${formatDay(subscription.graceEndsAt)}`;
    case "exempt":
      return subscription.exemptUntil === null ? label : `${label} until ${formatDay(subscription.exemptUntil)}`;
    case "active":
    case "suspended":
      return label;
  }
}

/** The warning a state calls for, or null when none does. */
export function subscriptionNotice(subscription: OrgSubscription): string | null {
  switch (subscription.state) {
    case "trialing":
      return subscription.nextBillingAt === null
        ? null
        : `Your trial ends ${formatDay(subscription.nextBillingAt)}. Add a payment method to keep your engine.`;
    case "past_due":
      return subscription.graceEndsAt === null
        ? "Payment failed. Update your payment method or hosted engines pause."
        : `Payment failed. Update by ${formatDay(subscription.graceEndsAt)} or hosted engines pause.`;
    case "suspended":
      return subscription.spinDownAt === null
        ? "Subscription ended. Hosted engines are paused."
        : `Subscription ended. Hosted engines pause on ${formatDay(subscription.spinDownAt)}.`;
    case "active":
    case "exempt":
      return null;
  }
}
