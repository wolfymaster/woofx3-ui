import type { LifecycleEvent, ProviderView } from "../billingLifecycle";
import type { SubscriptionState } from "../organization";
import type { ProviderSubscription } from "./provider";

/** The parts of a provider subscription the lifecycle reads. */
export type ProviderStandingFacts = Pick<
  ProviderSubscription,
  "standing" | "endedReason" | "plan" | "currentPeriodEnd"
>;

/**
 * The lifecycle event the provider's current truth means for the org. It is
 * derived from the subscription as fetched, never from the webhook's own
 * payload, so the order webhooks arrive in doesn't matter.
 */
export function lifecycleEventFor(
  state: SubscriptionState | null,
  subscription: ProviderStandingFacts
): LifecycleEvent {
  switch (subscription.standing) {
    case "good":
      return state === "active"
        ? { kind: "PaymentSucceeded", plan: subscription.plan, currentPeriodEnd: subscription.currentPeriodEnd }
        : { kind: "ProviderActivated", plan: subscription.plan, currentPeriodEnd: subscription.currentPeriodEnd };
    case "payment_failed":
      return { kind: "PaymentFailed" };
    case "ended":
      return { kind: "ProviderEnded", reason: subscription.endedReason ?? "provider_ended" };
  }
}

export function providerViewFor(subscription: ProviderStandingFacts): ProviderView {
  return {
    standing: subscription.standing,
    endedReason: subscription.endedReason,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
}
