import type { CheckoutPoll } from "@/lib/checkout-return";

/**
 * What the Sponsorship page's address says about a sponsorship checkout the person just left. The keys differ from the
 * organization checkout's (`checkout`, `checkoutId`) so the two returns never read each other's parameters.
 */
export type SponsorshipReturn = { kind: "none" } | { kind: "cancelled" } | { kind: "done"; checkoutId: string | null };

export function parseSponsorshipReturn(search: string): SponsorshipReturn {
  const params = new URLSearchParams(search);
  const outcome = params.get("sponsorship");
  if (outcome === "cancelled") {
    return { kind: "cancelled" };
  }
  if (outcome === "done") {
    const checkoutId = params.get("sponsorshipCheckout");
    return { kind: "done", checkoutId: checkoutId === null || checkoutId === "" ? null : checkoutId };
  }
  return { kind: "none" };
}

export const SPONSORSHIP_POLL_TEXT: Record<CheckoutPoll["phase"], string> = {
  polling: "Finalizing your payment...",
  complete: "Thank you for sponsoring woofx3! Your payment is confirmed.",
  expired: "That checkout expired before it was paid. Nothing was charged.",
  timed_out: "Your payment is still processing. Your sponsorship will show here once it is confirmed.",
};

export const SPONSORSHIP_UNTRACKED_TEXT = "Thanks! Your payment is being confirmed, and it shows here in a moment.";

export const SPONSORSHIP_CANCELLED_TEXT = "Checkout canceled. Nothing was charged.";

/** Added to the return address of the card-update page; must match `PAYMENT_METHOD_RETURN_QUERY` in convex/sponsorships.ts. */
export const PAYMENT_METHOD_RETURN_KEY = "sponsorshipPaymentMethod";

export const PAYMENT_METHOD_UPDATED_TEXT = "Payment method updated.";

export function paymentMethodReturned(search: string): boolean {
  return new URLSearchParams(search).get(PAYMENT_METHOD_RETURN_KEY) === "returned";
}

/** `search` without the card-update marker, so a reload does not confirm it again. Empty, or `?...`. */
export function withoutPaymentMethodReturn(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PAYMENT_METHOD_RETURN_KEY);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}
