import { type Infer, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { ProviderEndedReason, ProviderStanding } from "../billingLifecycle";
import type { AddOnKey } from "../entitlements";
import type { BillingInterval, PlanTier } from "../organization";

// The payment provider, seen from billing: domain code imports only this file.
// Each provider (Stripe today) implements BillingProvider at the edge, and
// woofx3 never touches card data or holds money: the provider does.

export type BillingProviderId = "stripe";

export type BillingError = {
  code: "provider_unavailable" | "invalid_request" | "bad_signature" | "unknown_price" | "unknown_discount";
  message: string;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: BillingError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: BillingError["code"], message: string): Result<T> {
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

/** A ProviderSubscription as a function argument. Add-on keys are checked against ADD_ONS where it is applied. */
export const providerSubscriptionValidator = v.object({
  customerRef: v.string(),
  subscriptionRef: v.string(),
  accountId: v.id("accounts"),
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

export type BillingEvent =
  | { kind: "subscription.changed"; eventId: string; type: string; subscriptionRef: string }
  | { kind: "ignored"; eventId: string; type: string };

export interface Invoice {
  id: string;
  periodStart: number;
  amountCents: number;
  status: string;
  hostedUrl: string | null;
}

export interface BillingProvider {
  readonly id: BillingProviderId;
  createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>>;
  createPortalSession(req: { customerRef: string; returnUrl: string }): Promise<Result<{ url: string }>>;
  verifyWebhook(rawBody: string, headers: Headers): Promise<Result<BillingEvent>>;
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
