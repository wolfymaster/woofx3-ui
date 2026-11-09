import type { Doc } from "../_generated/dataModel";
import { BILLING_LIFECYCLE, type WarningTemplate } from "./billingLifecycle";
import { dateText } from "./dateText";
import type { NotificationContent } from "./notifications";
import type { PlanTier, SubscriptionState } from "./organization";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The org portal's billing screen, inside the dashboard app. */
export const BILLING_PATH = "/org/billing";

const PLAN_NAMES: Record<PlanTier, string> = { starter: "Starter", pro: "Pro" };

/** The variables every billing template takes; the email templates use the same names. */
export interface WarningVariables {
  orgName: string;
  planName: string;
  dateText: string;
}

/** The date a warning is about, from the subscription it warns about. */
function warningDate(template: WarningTemplate, subscription: Doc<"subscriptions">, now: number): number {
  switch (template) {
    case "billing-trial-ending":
      return subscription.nextBillingAt ?? now;
    case "billing-payment-needed":
    case "billing-payment-failed":
      return subscription.graceEndsAt ?? now;
    case "billing-suspended":
    case "billing-engines-stopping":
      return subscription.spinDownAt ?? now;
    case "billing-engines-stopped":
    case "billing-reactivated":
      return now;
  }
}

export function warningVariables(
  template: WarningTemplate,
  account: Doc<"accounts">,
  subscription: Doc<"subscriptions">,
  now: number
): WarningVariables {
  return {
    orgName: account.name,
    planName: PLAN_NAMES[subscription.plan],
    dateText: dateText(warningDate(template, subscription, now)),
  };
}

const COPY: Record<WarningTemplate, (vars: WarningVariables) => { heading: string; description: string }> = {
  "billing-trial-ending": (vars) => ({
    heading: "Your trial is ending",
    description: `${vars.orgName}'s ${vars.planName} trial ends on ${vars.dateText}. Add a payment method to keep your engine running.`,
  }),
  "billing-payment-needed": (vars) => ({
    heading: "Payment needed",
    description: `${vars.orgName} needs a payment method by ${vars.dateText}, or its hosted engines will be paused.`,
  }),
  "billing-payment-failed": (vars) => ({
    heading: "Payment failed",
    description: `The last payment for ${vars.orgName} didn't go through. Update it by ${vars.dateText}, or its hosted engines will be paused.`,
  }),
  "billing-suspended": (vars) => ({
    heading: "Subscription ended",
    description: `${vars.orgName}'s subscription has ended. Its hosted engines will be paused on ${vars.dateText}.`,
  }),
  "billing-engines-stopping": (vars) => ({
    heading: "Engines pause soon",
    description: `${vars.orgName}'s hosted engines will be paused on ${vars.dateText}. Reactivate to keep them running.`,
  }),
  "billing-engines-stopped": (vars) => ({
    heading: "Engines paused",
    description: `${vars.orgName}'s hosted engines are paused. Your data is kept; reactivate to start them again.`,
  }),
  "billing-reactivated": (vars) => ({
    heading: "You're all set",
    description: `${vars.orgName}'s ${vars.planName} subscription is active again.`,
  }),
};

/** Who a warning goes to: the owner can act on billing; org admins are told. */
export type WarningRecipient = "owner" | "admin";

/** The in-app notice. Only the owner gets the link to Billing. */
export function warningNotification(
  template: WarningTemplate,
  vars: WarningVariables,
  recipient: WarningRecipient
): NotificationContent {
  const link = recipient === "owner" ? BILLING_PATH : null;
  return { ...COPY[template](vars), link, actionLabel: link === null ? null : "Billing" };
}

export type BannerKind = "trial_ending" | "payment_needed";

export interface BillingBanner {
  kind: BannerKind;
  /** When the trial ends, or when an unpaid org is suspended. */
  dateIso: string;
}

/**
 * The billing banner a hosted engine shows: in the last beforeBilling days of
 * a trial, and while past due. Nothing otherwise, including while exempt.
 */
export function billingBanner(
  subscription: { state: SubscriptionState; nextBillingAt: number | null; graceEndsAt: number | null } | null,
  now: number
): BillingBanner | null {
  if (subscription === null) {
    return null;
  }
  if (subscription.state === "trialing" && subscription.nextBillingAt !== null) {
    const windowDays = Math.max(...BILLING_LIFECYCLE.warningOffsetsDays.beforeBilling);
    const opensAt = subscription.nextBillingAt - windowDays * DAY_MS;
    return now >= opensAt
      ? { kind: "trial_ending", dateIso: new Date(subscription.nextBillingAt).toISOString() }
      : null;
  }
  if (subscription.state === "past_due" && subscription.graceEndsAt !== null) {
    return { kind: "payment_needed", dateIso: new Date(subscription.graceEndsAt).toISOString() };
  }
  return null;
}
