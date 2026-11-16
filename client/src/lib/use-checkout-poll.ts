import type { CheckoutState } from "@convex/lib/billingClient";
import { useEffect, useReducer } from "react";
import {
  CHECKOUT_POLL,
  type CheckoutPoll,
  type CheckoutPollEvent,
  INITIAL_CHECKOUT_POLL,
  nextCheckoutPoll,
} from "@/lib/checkout-return";

/**
 * Asks how the checkout the customer just paid for stands until it settles or the bound is reached. `ask` must be
 * stable between renders, or every render restarts the wait. `reflected` is whether what the checkout buys already
 * shows in the page's own data; a subject with nothing to wait for passes true.
 */
export function useCheckoutPoll(
  ask: (checkoutId: string) => Promise<CheckoutState>,
  checkoutId: string | null,
  reflected: boolean
): CheckoutPoll | null {
  const [poll, dispatch] = useReducer(
    (current: CheckoutPoll, event: CheckoutPollEvent) => nextCheckoutPoll(current, event, CHECKOUT_POLL.maxAttempts),
    INITIAL_CHECKOUT_POLL
  );
  const settled = poll.phase !== "polling";
  const attempts = poll.phase === "polling" ? poll.attempts : -1;
  useEffect(() => {
    if (checkoutId === null || settled) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        let event: CheckoutPollEvent;
        try {
          event = { type: "answered", state: await ask(checkoutId), reflected };
        } catch {
          // A failed ask is one spent attempt; the bound ends the polling.
          event = { type: "failed" };
        }
        if (!cancelled) {
          dispatch(event);
        }
      },
      attempts === 0 ? 0 : CHECKOUT_POLL.intervalMs
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ask, checkoutId, settled, attempts, reflected]);
  return checkoutId === null ? null : poll;
}
