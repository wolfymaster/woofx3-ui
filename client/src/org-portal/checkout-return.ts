import type { CheckoutState } from "@convex/lib/billingClient";

/** How long the page waits for a paid checkout to be confirmed before it stops asking. */
export const CHECKOUT_POLL = { intervalMs: 2_000, maxAttempts: 30 } as const;

/** What the billing page's address says about a checkout the customer just left. */
export type CheckoutReturn = { kind: "none" } | { kind: "cancelled" } | { kind: "done"; checkoutId: string | null };

export function parseCheckoutReturn(search: string): CheckoutReturn {
  const params = new URLSearchParams(search);
  const outcome = params.get("checkout");
  if (outcome === "cancelled") {
    return { kind: "cancelled" };
  }
  if (outcome === "done") {
    const checkoutId = params.get("checkoutId");
    return { kind: "done", checkoutId: checkoutId === null || checkoutId === "" ? null : checkoutId };
  }
  return { kind: "none" };
}

export type CheckoutPoll =
  | { phase: "polling"; attempts: number }
  | { phase: "complete" }
  | { phase: "expired" }
  | { phase: "timed_out" };

/** `reflected` is whether the org's own billing projection already shows the paid subscription. */
export type CheckoutPollEvent = { type: "answered"; state: CheckoutState; reflected: boolean } | { type: "failed" };

export const INITIAL_CHECKOUT_POLL: CheckoutPoll = { phase: "polling", attempts: 0 };

/**
 * Terminal phases stay put. A paid checkout only completes once the projection shows it; until then, like an
 * unanswered or unfinished ask, it counts toward the bound.
 */
export function nextCheckoutPoll(poll: CheckoutPoll, event: CheckoutPollEvent, maxAttempts: number): CheckoutPoll {
  if (poll.phase !== "polling") {
    return poll;
  }
  if (event.type === "answered" && event.state === "complete" && event.reflected) {
    return { phase: "complete" };
  }
  if (event.type === "answered" && event.state === "expired") {
    return { phase: "expired" };
  }
  const attempts = poll.attempts + 1;
  return attempts >= maxAttempts ? { phase: "timed_out" } : { phase: "polling", attempts };
}

export const CHECKOUT_POLL_TEXT: Record<CheckoutPoll["phase"], string> = {
  polling: "Finalizing your payment...",
  complete: "Payment received. Your plan is active.",
  expired: "That checkout expired before it was paid. Choose a plan to start again.",
  timed_out: "Your payment is still processing. Your plan will update here once it is confirmed.",
};

export const CHECKOUT_CANCELLED_TEXT = "Checkout cancelled. Nothing was charged.";
