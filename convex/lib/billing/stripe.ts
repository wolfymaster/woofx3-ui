import Stripe from "stripe";
import type { Id } from "../../_generated/dataModel";
import type { ProviderEndedReason, ProviderStanding } from "../billingLifecycle";
import { ADD_ONS, type AddOnKey } from "../entitlements";
import { BILLING_INTERVALS, type BillingInterval, PLAN_TIERS, type PlanTier } from "../organization";
import type { BillingConfig } from "./config";
import {
  type AppliedDiscount,
  type BillingEvent,
  type BillingProvider,
  type CheckoutRequest,
  type DiscountSpec,
  err,
  ok,
  type ProviderSubscription,
  type Result,
} from "./provider";

/**
 * The Stripe API version every call and webhook is pinned to. Bump it on
 * purpose, with STRIPE_SCHEMA_VERSION, after checking the fields read here.
 */
export const STRIPE_API_VERSION = "2026-10-28.endive";
/** `billingEvents.schemaVersion` for payloads of STRIPE_API_VERSION. */
export const STRIPE_SCHEMA_VERSION = 1;

export const STRIPE_CLIENT = {
  timeoutMs: 10_000,
  maxNetworkRetries: 2,
} as const;

// ---------------------------------------------------------------------------
// Pure mappings, tested without the network
// ---------------------------------------------------------------------------

/** The Stripe Price lookup key for a plan: `woofx3_<tier>_<interval>`. Convex stores no price ids. */
export function priceLookupKey(plan: PlanTier, interval: BillingInterval): string {
  return `woofx3_${plan}_${interval}`;
}

/** The plan a tier price's lookup key names, or null for any other price. */
export function parsePriceLookupKey(key: string | null): { plan: PlanTier; interval: BillingInterval } | null {
  const match = key === null ? null : /^woofx3_([a-z]+)_([a-z]+)$/.exec(key);
  if (match === null) {
    return null;
  }
  const plan = PLAN_TIERS.find((tier) => tier === match[1]);
  const interval = BILLING_INTERVALS.find((value) => value === match[2]);
  return plan !== undefined && interval !== undefined ? { plan, interval } : null;
}

/** An add-on's Price lookup key: `woofx3_addon_<key>`. */
export function addOnLookupKey(key: AddOnKey): string {
  return `woofx3_addon_${key}`;
}

function parseAddOnLookupKey(key: string | null): AddOnKey | null {
  const name = key?.startsWith("woofx3_addon_") ? key.slice("woofx3_addon_".length) : null;
  return name !== null && Object.keys(ADD_ONS).includes(name) ? (name as AddOnKey) : null;
}

type StandingRow = { standing: ProviderStanding; endedReason: ProviderEndedReason | null } | "ignore";

/**
 * Every Stripe subscription status, mapped once. `incomplete` (a first
 * payment not yet confirmed) is ignored until it resolves either way.
 */
const STANDING: Record<string, (cancelAtPeriodEnd: boolean) => StandingRow> = {
  active: () => ({ standing: "good", endedReason: null }),
  trialing: () => ({ standing: "good", endedReason: null }),
  past_due: () => ({ standing: "payment_failed", endedReason: null }),
  canceled: (cancelAtPeriodEnd) => ({
    standing: "ended",
    endedReason: cancelAtPeriodEnd ? "subscription_canceled" : "provider_ended",
  }),
  unpaid: () => ({ standing: "ended", endedReason: "provider_ended" }),
  incomplete_expired: () => ({ standing: "ended", endedReason: "provider_ended" }),
  paused: () => ({ standing: "ended", endedReason: "provider_ended" }),
  incomplete: () => "ignore",
};

/** The standing a Stripe status means; throws on a status Stripe added that this table lacks. */
export function standingOf(status: string, cancelAtPeriodEnd: boolean): StandingRow {
  const row = STANDING[status];
  if (row === undefined) {
    throw new Error(`Unmapped Stripe subscription status "${status}"`);
  }
  return row(cancelAtPeriodEnd);
}

/** The deterministic Stripe coupon id for one of our discounts, so creating it twice is harmless. */
export function couponId(key: string): string {
  if (!/^[a-z0-9_-]{1,40}$/.test(key)) {
    throw new Error(`Discount key "${key}" must be 1-40 lowercase letters, digits, dashes or underscores`);
  }
  return `woofx3_${key}`;
}

export function couponParams(key: string, spec: DiscountSpec): Stripe.CouponCreateParams {
  const duration: Pick<Stripe.CouponCreateParams, "duration" | "duration_in_months"> =
    spec.duration.kind === "months"
      ? { duration: "repeating", duration_in_months: spec.duration.months }
      : { duration: spec.duration.kind };
  if (spec.duration.kind === "months" && !(Number.isInteger(spec.duration.months) && spec.duration.months >= 1)) {
    throw new Error(`A discount's months must be a whole number of at least 1; got ${spec.duration.months}`);
  }
  if (spec.kind === "percent_off") {
    if (!(spec.percent > 0 && spec.percent <= 100)) {
      throw new Error(`percent_off must be in (0, 100]; got ${spec.percent}`);
    }
    return { id: couponId(key), percent_off: spec.percent, ...duration };
  }
  if (!(Number.isInteger(spec.amountCents) && spec.amountCents > 0)) {
    throw new Error(`amount_off must be a whole number of cents above 0; got ${spec.amountCents}`);
  }
  return { id: couponId(key), amount_off: spec.amountCents, currency: spec.currency, ...duration };
}

/** Our spec for a Stripe coupon; null for a coupon shape we never create (another currency). */
export function specOfCoupon(coupon: Stripe.Coupon): DiscountSpec | null {
  const duration =
    coupon.duration === "repeating"
      ? { kind: "months" as const, months: coupon.duration_in_months ?? 0 }
      : coupon.duration === "once"
        ? { kind: "once" as const }
        : { kind: "forever" as const };
  if (coupon.percent_off !== null) {
    return { kind: "percent_off", percent: coupon.percent_off, duration };
  }
  if (coupon.amount_off !== null && coupon.currency === "usd") {
    return { kind: "amount_off", amountCents: coupon.amount_off, currency: "usd", duration };
  }
  return null;
}

function appliedDiscount(discount: Stripe.Discount | string): AppliedDiscount | null {
  if (typeof discount === "string" || typeof discount.source.coupon !== "object" || discount.source.coupon === null) {
    return null;
  }
  const spec = specOfCoupon(discount.source.coupon);
  if (spec === null) {
    return null;
  }
  const code = typeof discount.promotion_code === "object" ? (discount.promotion_code?.code ?? null) : null;
  return { spec, code, endsAt: discount.end === null ? null : discount.end * 1000 };
}

function idOf(value: string | { id: string } | null): string | null {
  return value === null ? null : typeof value === "string" ? value : value.id;
}

/** A Stripe subscription in our terms. Ignored (null) while `incomplete`. */
export function toProviderSubscription(
  subscription: Stripe.Subscription,
  observedAt: number
): Result<ProviderSubscription | null> {
  const standing = standingOf(subscription.status, subscription.cancel_at_period_end);
  if (standing === "ignore") {
    return ok(null);
  }
  const accountId = subscription.metadata.accountId;
  if (accountId === undefined || accountId === "") {
    return err("invalid_request", `Stripe subscription ${subscription.id} has no accountId metadata`);
  }
  let tier: { plan: PlanTier; interval: BillingInterval; periodEnd: number } | null = null;
  const addOns: AddOnKey[] = [];
  for (const item of subscription.items.data) {
    const parsed = parsePriceLookupKey(item.price.lookup_key);
    const addOn = parseAddOnLookupKey(item.price.lookup_key);
    if (parsed !== null) {
      tier = { ...parsed, periodEnd: item.current_period_end * 1000 };
    } else if (addOn !== null) {
      addOns.push(addOn);
    } else {
      return err("unknown_price", `Stripe price ${item.price.id} (${item.price.lookup_key}) is not a woofx3 price`);
    }
  }
  if (tier === null) {
    return err("unknown_price", `Stripe subscription ${subscription.id} has no woofx3 plan price`);
  }
  const customerRef = idOf(subscription.customer);
  if (customerRef === null) {
    return err("invalid_request", `Stripe subscription ${subscription.id} has no customer`);
  }
  const discount = subscription.discounts.map(appliedDiscount).find((applied) => applied !== null) ?? null;
  return ok({
    customerRef,
    subscriptionRef: subscription.id,
    accountId: accountId as Id<"accounts">,
    plan: tier.plan,
    interval: tier.interval,
    addOns,
    standing: standing.standing,
    endedReason: standing.endedReason,
    providerStatus: subscription.status,
    currentPeriodEnd: tier.periodEnd,
    discount,
    observedAt,
  });
}

/** The subscription an event is about, for the events that can change one. */
export function subscriptionRefOf(event: Stripe.Event): string | null {
  const object = event.data.object;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return (object as Stripe.Subscription).id;
    case "invoice.paid":
    case "invoice.payment_failed":
      return idOf((object as Stripe.Invoice).parent?.subscription_details?.subscription ?? null);
    case "checkout.session.completed":
      return idOf((object as Stripe.Checkout.Session).subscription ?? null);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function stripeClient(config: BillingConfig): Stripe {
  return new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    timeout: STRIPE_CLIENT.timeoutMs,
    maxNetworkRetries: STRIPE_CLIENT.maxNetworkRetries,
  });
}

function failure<T>(error: unknown): Result<T> {
  if (error instanceof Stripe.errors.StripeError) {
    const code = error.type === "StripeInvalidRequestError" ? "invalid_request" : "provider_unavailable";
    return err(code, `Stripe: ${error.message}`);
  }
  throw error;
}

export class StripeBillingProvider implements BillingProvider {
  readonly id = "stripe" as const;
  private readonly crypto = Stripe.createSubtleCryptoProvider();

  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
    private readonly now: () => number
  ) {}

  private async priceId(lookupKey: string): Promise<Result<string>> {
    const prices = await this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data[0];
    return price === undefined ? err("unknown_price", `No active Stripe price ${lookupKey}`) : ok(price.id);
  }

  private async promotionCodeId(code: string): Promise<Stripe.PromotionCode | null> {
    const codes = await this.stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
      expand: ["data.promotion.coupon"],
    });
    return codes.data[0] ?? null;
  }

  async createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>> {
    try {
      const price = await this.priceId(priceLookupKey(req.plan, req.interval));
      if (!price.ok) {
        return price;
      }
      let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
      if (req.promotionCode !== null) {
        const promotion = await this.promotionCodeId(req.promotionCode);
        if (promotion === null) {
          return err("unknown_discount", `No active promotion code ${req.promotionCode}`);
        }
        discounts = [{ promotion_code: promotion.id }];
      }
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: price.value, quantity: 1 }],
          customer: req.customerRef ?? undefined,
          client_reference_id: req.accountId,
          subscription_data: { metadata: { accountId: req.accountId } },
          metadata: { accountId: req.accountId },
          discounts,
          // Stripe takes either discounts or allow_promotion_codes, never both.
          allow_promotion_codes: discounts === undefined ? req.allowPromotionCodes : undefined,
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
        },
        { idempotencyKey: req.idempotencyKey }
      );
      return session.url === null
        ? err("provider_unavailable", "Stripe returned a checkout without a URL")
        : ok({ url: session.url });
    } catch (error) {
      return failure(error);
    }
  }

  async createPortalSession(req: { customerRef: string; returnUrl: string }): Promise<Result<{ url: string }>> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: req.customerRef,
        return_url: req.returnUrl,
      });
      return ok({ url: session.url });
    } catch (error) {
      return failure(error);
    }
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<Result<BillingEvent>> {
    const signature = headers.get("stripe-signature");
    if (signature === null) {
      return err("bad_signature", "Missing Stripe-Signature header");
    }
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        this.webhookSecret,
        undefined,
        this.crypto
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        return err("bad_signature", error.message);
      }
      throw error;
    }
    const subscriptionRef = subscriptionRefOf(event);
    return ok(
      subscriptionRef === null
        ? { kind: "ignored", eventId: event.id, type: event.type }
        : { kind: "subscription.changed", eventId: event.id, type: event.type, subscriptionRef }
    );
  }

  async fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription>> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionRef, {
        expand: ["discounts.source.coupon", "discounts.promotion_code"],
      });
      const mapped = toProviderSubscription(subscription, this.now());
      if (!mapped.ok) {
        return mapped;
      }
      if (mapped.value === null) {
        return err("invalid_request", `Stripe subscription ${subscriptionRef} is still incomplete`);
      }
      return ok(mapped.value);
    } catch (error) {
      return failure(error);
    }
  }

  async applyDiscount(req: {
    subscriptionRef: string;
    key: string;
    spec: DiscountSpec;
    idempotencyKey: string;
  }): Promise<Result<AppliedDiscount>> {
    try {
      const params = couponParams(req.key, req.spec);
      const id = couponId(req.key);
      const existing = await this.stripe.coupons.retrieve(id).catch((error: unknown) => {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") {
          return null;
        }
        throw error;
      });
      if (existing === null) {
        await this.stripe.coupons.create(params, { idempotencyKey: `${req.idempotencyKey}:coupon` });
      }
      const subscription = await this.stripe.subscriptions.update(
        req.subscriptionRef,
        { discounts: [{ coupon: id }], expand: ["discounts.source.coupon"] },
        { idempotencyKey: req.idempotencyKey }
      );
      const applied = subscription.discounts.map(appliedDiscount).find((discount) => discount !== null);
      return applied === undefined ? err("unknown_discount", `Coupon ${id} did not attach`) : ok(applied);
    } catch (error) {
      return failure(error);
    }
  }

  async lookupPromotionCode(code: string): Promise<Result<AppliedDiscount | null>> {
    try {
      const promotion = await this.promotionCodeId(code);
      const coupon = promotion?.promotion.coupon;
      if (promotion === null || typeof coupon !== "object" || coupon === null) {
        return ok(null);
      }
      const spec = specOfCoupon(coupon);
      return ok(spec === null ? null : { spec, code: promotion.code, endsAt: null });
    } catch (error) {
      return failure(error);
    }
  }
}
