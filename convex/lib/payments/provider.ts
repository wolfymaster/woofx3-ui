import type { Id } from "../../_generated/dataModel";
import type { ProviderEndedReason, ProviderStanding } from "../billingLifecycle";
import type { AddOnKey } from "../entitlements";
import type { BillingInterval, PlanTier } from "../organization";

// The payments module: every flow that moves money (subscriptions today)
// goes through it, and domain code imports only this file. Each provider
// (Stripe today) implements PaymentProvider at the edge, and woofx3 never
// touches card data or holds money: the provider does.

export type PaymentProviderId = "stripe";

export interface PaymentError {
  code: "provider_unavailable" | "invalid_request" | "bad_signature" | "unknown_price" | "unknown_discount";
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: PaymentError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: PaymentError["code"], message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

export type DiscountDuration = { kind: "once" } | { kind: "months"; months: number } | { kind: "forever" };

/** Ours, not the provider's: what a discount does. */
export type DiscountSpec =
  | { kind: "percent_off"; percent: number; duration: DiscountDuration }
  | { kind: "amount_off"; amountCents: number; currency: "usd"; duration: DiscountDuration };

/** A discount on a subscription, mirrored onto `subscriptions.discount` for display. */
export interface AppliedDiscount {
  spec: DiscountSpec;
  code: string | null;
  endsAt: number | null;
}

export interface CheckoutRequest {
  accountId: Id<"accounts">;
  customerRef: string | null;
  plan: PlanTier;
  interval: BillingInterval;
  /** A code the owner typed in our UI, if any. */
  promotionCode: string | null;
  /** Let the provider's checkout take a code too. */
  allowPromotionCodes: boolean;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

/** The provider's truth about one subscription, mapped into our terms. */
export interface ProviderSubscription {
  customerRef: string;
  subscriptionRef: string;
  accountId: Id<"accounts">;
  plan: PlanTier;
  interval: BillingInterval;
  addOns: AddOnKey[];
  standing: ProviderStanding;
  endedReason: ProviderEndedReason | null;
  /** The raw provider status, for operators. */
  providerStatus: string;
  currentPeriodEnd: number;
  discount: AppliedDiscount | null;
  /** When this was read from the provider; older reads are stale. */
  observedAt: number;
}

export type PaymentEvent =
  | { kind: "subscription.changed"; eventId: string; type: string; subscriptionRef: string }
  | { kind: "ignored"; eventId: string; type: string };

export interface Invoice {
  id: string;
  periodStart: number;
  amountCents: number;
  status: string;
  hostedUrl: string | null;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>>;
  createPortalSession(req: { customerRef: string; returnUrl: string }): Promise<Result<{ url: string }>>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<Result<PaymentEvent>>;
  fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription>>;
  /** Creates the provider's coupon for `key` if missing (a deterministic id), then attaches it. */
  applyDiscount(req: {
    subscriptionRef: string;
    key: string;
    spec: DiscountSpec;
    idempotencyKey: string;
  }): Promise<Result<AppliedDiscount>>;
  /** A promotion code's discount, to show before checkout; null when it doesn't exist or is inactive. */
  lookupPromotionCode(code: string): Promise<Result<AppliedDiscount | null>>;
}
