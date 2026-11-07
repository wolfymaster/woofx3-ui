import Stripe from "stripe";
import type { Id } from "../../_generated/dataModel";
import type { ProviderEndedReason, ProviderStanding } from "../billingLifecycle";
import { ADD_ONS, type AddOnKey } from "../entitlements";
import { BILLING_INTERVALS, type BillingInterval, PLAN_TIERS, type PlanTier } from "../organization";
import type { PaymentsConfig } from "./config";
import {
  type AppliedDiscount,
  type CheckoutPurpose,
  type CheckoutRequest,
  type DiscountDuration,
  type DiscountSpec,
  err,
  type Invoice,
  type InvoiceStatus,
  ok,
  type PaymentError,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentPurposeKind,
  type ProviderSubscription,
  type PurposeMetadata,
  parsePaymentPurposeKind,
  purposeMetadata,
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

/** The coupon fields a discount is read from. */
export type CouponFields = Pick<
  Stripe.Coupon,
  "percent_off" | "amount_off" | "currency" | "duration" | "duration_in_months"
>;

function durationOfCoupon(coupon: CouponFields): DiscountDuration {
  switch (coupon.duration) {
    case "repeating":
      return { kind: "months", months: coupon.duration_in_months ?? 0 };
    case "once":
      return { kind: "once" };
    case "forever":
      return { kind: "forever" };
    default:
      throw new Error(`Unmapped Stripe coupon duration "${coupon.duration}"`);
  }
}

/** Our spec for a Stripe coupon; null for a coupon shape we never create (another currency). */
export function specOfCoupon(coupon: CouponFields): DiscountSpec | null {
  const duration = durationOfCoupon(coupon);
  if (coupon.percent_off !== null) {
    return { kind: "percent_off", percent: coupon.percent_off, duration };
  }
  if (coupon.amount_off !== null && coupon.currency === "usd") {
    return { kind: "amount_off", amountCents: coupon.amount_off, currency: "usd", duration };
  }
  return null;
}

/** Whether two discounts give the same terms. */
export function sameDiscount(a: DiscountSpec | null, b: DiscountSpec): boolean {
  if (a === null || a.duration.kind !== b.duration.kind) {
    return false;
  }
  if (a.duration.kind === "months" && b.duration.kind === "months" && a.duration.months !== b.duration.months) {
    return false;
  }
  if (a.kind === "percent_off" && b.kind === "percent_off") {
    return a.percent === b.percent;
  }
  if (a.kind === "amount_off" && b.kind === "amount_off") {
    return a.amountCents === b.amountCents && a.currency === b.currency;
  }
  return false;
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
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : value.id;
}

/** The subscription fields this adapter reads. */
export type SubscriptionFields = Pick<
  Stripe.Subscription,
  "id" | "status" | "cancel_at_period_end" | "customer" | "metadata" | "discounts"
> & {
  items: { data: Array<{ price: Pick<Stripe.Price, "id" | "lookup_key">; current_period_end: number }> };
};

/** A Stripe subscription in our terms. Null while `incomplete`, and for one another purpose created. */
export function toProviderSubscription(
  subscription: SubscriptionFields,
  observedAt: number
): Result<ProviderSubscription | null> {
  if (parsePaymentPurposeKind(subscription.metadata.purpose) !== "subscription") {
    return ok(null);
  }
  const standing = standingOf(subscription.status, subscription.cancel_at_period_end);
  if (standing === "ignore") {
    return ok(null);
  }
  const accountId = subscription.metadata.ref;
  if (accountId === undefined || accountId === "") {
    return err("invalid_request", `Stripe subscription ${subscription.id} has no ref metadata`);
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

/**
 * The purpose stamped on the object an event is about. An invoice carries its
 * subscription's metadata as it was when the invoice was finalized.
 */
export function purposeOf(event: Stripe.Event): PaymentPurposeKind | null {
  const object = event.data.object;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return parsePaymentPurposeKind((object as Stripe.Subscription).metadata.purpose);
    case "invoice.paid":
    case "invoice.payment_failed":
      return parsePaymentPurposeKind(
        (object as Stripe.Invoice).parent?.subscription_details?.metadata?.purpose ?? null
      );
    case "checkout.session.completed":
      return parsePaymentPurposeKind((object as Stripe.Checkout.Session).metadata?.purpose ?? null);
    default:
      return null;
  }
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
// Invoices
// ---------------------------------------------------------------------------

const INVOICE_STATUSES: Record<InvoiceStatus, true> = {
  draft: true,
  open: true,
  paid: true,
  uncollectible: true,
  void: true,
};

function invoiceStatus(status: InvoiceFields["status"]): InvoiceStatus | null {
  // Stripe leaves the status unset only before an invoice is first saved, which is still a draft.
  if (status === null) {
    return "draft";
  }
  return (Object.keys(INVOICE_STATUSES) as InvoiceStatus[]).find((known) => known === status) ?? null;
}

/** The invoice fields toInvoice reads. */
export type InvoiceFields = Pick<Stripe.Invoice, "id" | "status" | "period_start" | "total" | "hosted_invoice_url">;

/** A Stripe invoice in our terms; an error for a status this API version doesn't define. */
export function toInvoice(invoice: InvoiceFields): Result<Invoice> {
  const status = invoiceStatus(invoice.status);
  if (status === null) {
    return err("invalid_request", `Stripe invoice ${invoice.id} has unknown status ${invoice.status}`);
  }
  return ok({
    id: invoice.id,
    periodStart: invoice.period_start * 1000,
    amountCents: invoice.total,
    status,
    hostedUrl: invoice.hosted_invoice_url ?? null,
  });
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function stripeClient(config: PaymentsConfig): Stripe {
  return new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    timeout: STRIPE_CLIENT.timeoutMs,
    maxNetworkRetries: STRIPE_CLIENT.maxNetworkRetries,
  });
}

/** Stripe error types that mean something other than the provider being unavailable. */
const STRIPE_ERROR_CODES: Partial<Record<string, PaymentError["code"]>> = {
  StripeInvalidRequestError: "invalid_request",
  // The idempotency key was used for a request with other parameters: another checkout is open.
  StripeIdempotencyError: "checkout_in_progress",
};

function failure<T>(error: unknown): Result<T> {
  if (error instanceof Stripe.errors.StripeError) {
    return err(STRIPE_ERROR_CODES[error.type] ?? "provider_unavailable", `Stripe: ${error.message}`);
  }
  throw error;
}

export class StripePaymentProvider implements PaymentProvider {
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
    switch (req.purpose.kind) {
      case "subscription":
        return this.createSubscriptionCheckout(req, req.purpose);
    }
  }

  private async createSubscriptionCheckout(
    req: CheckoutRequest,
    purpose: Extract<CheckoutPurpose, { kind: "subscription" }>
  ): Promise<Result<{ url: string }>> {
    try {
      const price = await this.priceId(priceLookupKey(purpose.plan, purpose.interval));
      if (!price.ok) {
        return price;
      }
      let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
      if (purpose.promotionCode !== null) {
        const promotion = await this.promotionCodeId(purpose.promotionCode);
        if (promotion === null) {
          return err("unknown_discount", `No active promotion code ${purpose.promotionCode}`);
        }
        discounts = [{ promotion_code: promotion.id }];
      }
      const metadata = { ...purposeMetadata(purpose) };
      // A trialing org that subscribes starts paying now: the unused trial
      // days are deliberately not carried over as a Stripe trial.
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: price.value, quantity: 1 }],
          customer: req.customerRef ?? undefined,
          client_reference_id: purpose.accountId,
          subscription_data: { metadata },
          metadata,
          discounts,
          // Stripe takes either discounts or allow_promotion_codes, never both.
          allow_promotion_codes: discounts === undefined ? req.allowPromotionCodes : undefined,
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          expires_at: Math.floor(req.expiresAt / 1000),
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

  async verifyWebhook(rawBody: string, headers: Headers): Promise<Result<PaymentEvent>> {
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
    return ok({
      eventId: event.id,
      type: event.type,
      purpose: purposeOf(event),
      subscriptionRef: subscriptionRefOf(event),
    });
  }

  async fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription | null>> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionRef, {
        expand: ["discounts.source.coupon", "discounts.promotion_code"],
      });
      return toProviderSubscription(subscription, this.now());
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
      if (existing !== null && !sameDiscount(specOfCoupon(existing), req.spec)) {
        return err(
          "invalid_request",
          `Coupon ${id} already exists with different terms; use a new discount key for new terms`
        );
      }
      if (existing === null) {
        // A coupon is shared by every subscription it is applied to, so its ref is our discount key.
        const metadata: PurposeMetadata = { purpose: "subscription", ref: req.key };
        await this.stripe.coupons.create(
          { ...params, metadata: { ...metadata } },
          { idempotencyKey: `${req.idempotencyKey}:coupon` }
        );
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

  async listInvoices(customerRef: string, limit: number): Promise<Result<Invoice[]>> {
    try {
      const page = await this.stripe.invoices.list({ customer: customerRef, limit });
      const invoices: Invoice[] = [];
      for (const invoice of page.data) {
        const mapped = toInvoice(invoice);
        if (!mapped.ok) {
          return mapped;
        }
        invoices.push(mapped.value);
      }
      return ok(invoices);
    } catch (error) {
      return failure(error);
    }
  }
}
