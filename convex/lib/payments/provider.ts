import { type Infer, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { ProviderEndedReason, ProviderStanding } from "../billingLifecycle";
import type { AddOnKey } from "../entitlements";
import { type BillingInterval, billingIntervalValidator, type PlanTier, planTierValidator } from "../organization";

// The payments module: every flow that moves money (subscriptions today)
// goes through it, and domain code imports only this file. Each provider
// (Stripe today) implements PaymentProvider at the edge, and woofx3 never
// touches card data or holds money: the provider does.

export type PaymentProviderId = "stripe";

export type PaymentError = {
  code:
    | "provider_unavailable"
    | "invalid_request"
    | "bad_signature"
    | "unknown_price"
    | "unknown_discount"
    // A checkout under the same idempotency key is open with other parameters.
    | "checkout_in_progress";
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: PaymentError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: PaymentError["code"], message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

const discountDurationValidator = v.union(
  v.object({ kind: v.literal("once") }),
  v.object({ kind: v.literal("months"), months: v.number() }),
  v.object({ kind: v.literal("forever") })
);
export type DiscountDuration = Infer<typeof discountDurationValidator>;

/** Ours, not the provider's: what a discount does. */
export const discountSpecValidator = v.union(
  v.object({ kind: v.literal("percent_off"), percent: v.number(), duration: discountDurationValidator }),
  v.object({
    kind: v.literal("amount_off"),
    amountCents: v.number(),
    currency: v.literal("usd"),
    duration: discountDurationValidator,
  })
);
export type DiscountSpec = Infer<typeof discountSpecValidator>;

/** A discount on a subscription, mirrored onto `subscriptions.discount` for display. */
export const appliedDiscountValidator = v.object({
  spec: discountSpecValidator,
  code: v.union(v.string(), v.null()),
  endsAt: v.union(v.number(), v.null()),
});
export type AppliedDiscount = Infer<typeof appliedDiscountValidator>;

/**
 * What a checkout is for. Each purpose is one kind of money movement with the
 * fields it needs; the webhook routes the provider's events on `kind`. A new
 * way to take money (a marketplace purchase priced inline, a payment to a
 * connected account) is a new member here and a new case in each provider,
 * and callers of createCheckout don't change. It is kept on the checkout's
 * `paymentSessions` row as the quote the session charges, so the row, not
 * the provider's metadata, says what a completed payment grants.
 */
export const checkoutPurposeValidator = v.union(
  v.object({
    kind: v.literal("subscription"),
    accountId: v.id("accounts"),
    plan: planTierValidator,
    interval: billingIntervalValidator,
    /** A code the owner typed in our UI, if any. */
    promotionCode: v.union(v.string(), v.null()),
  })
);
export type CheckoutPurpose = Infer<typeof checkoutPurposeValidator>;

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
  /**
   * Shared by every request for the same checkout attempt, so concurrent or
   * repeated requests get the one session the first opened. Requests under it
   * must carry identical parameters, `expiresAt` included.
   */
  idempotencyKey: string;
  /** When the session closes unpaid. */
  expiresAt: number;
}

/** A checkout session the provider opened, with what it will charge. */
export interface CheckoutSession {
  url: string;
  sessionRef: string;
  amountCents: number;
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

/**
 * A ProviderSubscription as a function argument. The org id came from provider
 * metadata, so it is a plain string here and looked up where it is applied,
 * as are the add-on keys against ADD_ONS.
 */
export const providerSubscriptionValidator = v.object({
  customerRef: v.string(),
  subscriptionRef: v.string(),
  accountId: v.string(),
  plan: v.union(v.literal("starter"), v.literal("pro")),
  interval: v.union(v.literal("month"), v.literal("year")),
  addOns: v.array(v.string()),
  standing: v.union(v.literal("good"), v.literal("payment_failed"), v.literal("ended")),
  endedReason: v.union(v.literal("subscription_canceled"), v.literal("provider_ended"), v.null()),
  providerStatus: v.string(),
  currentPeriodEnd: v.number(),
  discount: v.union(appliedDiscountValidator, v.null()),
  observedAt: v.number(),
});

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
  /** What happened to a checkout session, when the event is about one. */
  session: SessionChange | null;
}

/**
 * A checkout session's change: paid (completed with its payment confirmed),
 * completed but awaiting a delayed payment, or closed unpaid.
 */
export interface SessionChange {
  sessionRef: string;
  change: "paid" | "awaiting_payment" | "expired";
}

export type InvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/** One of a customer's invoices, read live from the provider for display. woofx3 stores none. */
export interface Invoice {
  id: string;
  periodStart: number;
  amountCents: number;
  status: InvoiceStatus;
  /** The provider's page for the invoice; null while it is a draft. */
  hostedUrl: string | null;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createCheckout(req: CheckoutRequest): Promise<Result<CheckoutSession>>;
  /** Closes an open checkout session unpaid. A session no longer open is `invalid_request`. */
  expireCheckout(sessionRef: string): Promise<Result<null>>;
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
  /** The customer's newest invoices first, at most `limit`. */
  listInvoices(customerRef: string, limit: number): Promise<Result<Invoice[]>>;
}
