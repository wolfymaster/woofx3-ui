import type { CheckoutRefusal } from "@convex/billing";
import type { MyOrganization, OrgSubscription } from "@convex/organizations";
import { ConvexError } from "convex/values";

/**
 * What Plan & billing shows for an organization:
 * - no_subscription_needed: it has no hosted engine, so nothing is billed
 * - no_plan: a hosted engine but no subscription yet
 * - exempt: complimentary, with nothing to buy or manage
 * - provider_managed: a provider subscription that is still running; changes go through its portal
 * - choose_plan: trialing, ended, or never paid, so the owner picks a plan to check out
 */
export type BillingView =
  | { kind: "no_subscription_needed" }
  | { kind: "no_plan" }
  | { kind: "exempt"; subscription: OrgSubscription }
  | { kind: "provider_managed"; subscription: OrgSubscription }
  | { kind: "choose_plan"; subscription: OrgSubscription };

export function billingView(organization: Pick<MyOrganization, "engines" | "subscription">): BillingView {
  if (!organization.engines.some((engine) => engine.hosting === "managed")) {
    return { kind: "no_subscription_needed" };
  }
  const { subscription } = organization;
  if (subscription === null) {
    return { kind: "no_plan" };
  }
  if (subscription.state === "exempt") {
    return { kind: "exempt", subscription };
  }
  if (subscription.hasProviderSubscription && subscription.state !== "suspended") {
    return { kind: "provider_managed", subscription };
  }
  return { kind: "choose_plan", subscription };
}

const PORTAL_REFUSAL: CheckoutRefusal["code"] = "subscription_exists";

/** Whether a refused checkout means the org's live but failing subscription is to be fixed in the customer portal. */
export function checkoutNeedsPortal(error: unknown): boolean {
  if (!(error instanceof ConvexError)) {
    return false;
  }
  const data: unknown = error.data;
  return typeof data === "object" && data !== null && "code" in data && data.code === PORTAL_REFUSAL;
}
