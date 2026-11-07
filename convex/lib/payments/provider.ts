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

/**
 * What a checkout is for. Each purpose is one kind of money movement with the
 * fields it needs; the webhook routes the provider's events on `kind`. A new
 * way to take money (a marketplace purchase priced inline, a payment to a
 * connected account) is a new member here and a new case in each provider,
 * and callers of createCheckout don't change.
 */
export type CheckoutPurpose = {
  kind: "subscription";
  accountId: Id<"accounts">;
  plan: PlanTier;
  interval: BillingInterval;
  /** A code the owner typed in our UI, if any. */
  promotionCode: string | null;
};

export type PaymentPurposeKind = CheckoutPurpose["kind"];

const PAYMENT_PURPOSE_KINDS: Record<PaymentPurposeKind, true> = { subscription: true };

/** A purpose kind read back from provider metadata; null for none, or one this deployment doesn't know. */
export function parsePaymentPurposeKind(value: string | null | undefined): PaymentPurposeKind | null {
  return (Object.keys(PAYMENT_PURPOSE_KINDS) as PaymentPurposeKind[]).find((kind) => kind === value) ?? null;
}

/**
 * The metadata on every provider object we create: its purpose, and `ref`,
 * the id of our own row it belongs to (the org, for a subscription). Who gets
 * what is decided by that row, never by the metadata alone.
 */
export interface PurposeMetadata {
  purpose: PaymentPurposeKind;
  ref: string;
}

export function purposeMetadata(purpose: CheckoutPurpose): PurposeMetadata {
  switch (purpose.kind) {
    case "subscription":
      return { purpose: "subscription", ref: purpose.accountId };
  }
}

export interface CheckoutRequest {
  purpose: CheckoutPurpose;
  customerRef: string | null;
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

/** A verified provider event, with what the webhook routes it on. */
export interface PaymentEvent {
  eventId: string;
  type: string;
  /**
   * The purpose in the metadata of the object the event is about; null when
   * it carries none we know, so the event isn't ours to act on.
   */
  purpose: PaymentPurposeKind | null;
  /** The provider subscription the event is about, when it is about one. */
  subscriptionRef: string | null;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>>;
  createPortalSession(req: { customerRef: string; returnUrl: string }): Promise<Result<{ url: string }>>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<Result<PaymentEvent>>;
  /**
   * The subscription as the provider holds it now. Null when there is nothing
   * to apply: its first payment is still unconfirmed, or another purpose
   * created it.
   */
  fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription | null>>;
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
