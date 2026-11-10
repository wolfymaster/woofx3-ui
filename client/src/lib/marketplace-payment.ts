import type { MarketplaceCheckout, MarketplacePurchaseIntent } from "@/engine/types";

// Paying for a listing the install flow could not acquire. The flow knows
// only this one command: it hands over the purchase the marketplace quoted and
// gets back where to send the browser, so the payment provider behind it can
// change without the flow noticing.

/** What starting a payment came to. */
export type PaymentStart =
  /** Pay at `url`; the payment page sends the browser back to the listing. */
  | { status: "redirect"; url: string }
  /** Nothing is owed after all, such as a purchase already completed: acquire again. */
  | { status: "settled" }
  /** Nothing can be paid for here; `message` says why. */
  | { status: "unavailable"; message: string };

export interface PaymentRequest {
  listingId: string;
  intent: MarketplacePurchaseIntent;
}

export type StartPayment = (request: PaymentRequest) => Promise<PaymentStart>;

/** The install flow's reading of a marketplace checkout. */
export function paymentStartFromCheckout(checkout: MarketplaceCheckout): PaymentStart {
  switch (checkout.status) {
    case "redirect":
      return { status: "redirect", url: checkout.url };
    case "already_entitled":
    case "no_payment_needed":
      return { status: "settled" };
    case "unavailable":
      return { status: "unavailable", message: checkout.message };
  }
}
