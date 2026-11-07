import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import { parsePaymentsConfig } from "./config";
import type { DiscountSpec } from "./provider";
import {
  type CouponFields,
  couponId,
  couponParams,
  parsePriceLookupKey,
  priceLookupKey,
  StripePaymentProvider,
  type SubscriptionFields,
  specOfCoupon,
  standingOf,
  toProviderSubscription,
} from "./stripe";

const SECRET = "whsec_test_secret";
const VALID_ENV = {
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: SECRET,
  ORG_PORTAL_URL: "https://woofx3.tv/org",
};

describe("standing map", () => {
  const cases: Array<[string, boolean, ReturnType<typeof standingOf>]> = [
    ["active", false, { standing: "good", endedReason: null }],
    ["trialing", false, { standing: "good", endedReason: null }],
    ["past_due", false, { standing: "payment_failed", endedReason: null }],
    ["canceled", true, { standing: "ended", endedReason: "subscription_canceled" }],
    ["canceled", false, { standing: "ended", endedReason: "provider_ended" }],
    ["unpaid", false, { standing: "ended", endedReason: "provider_ended" }],
    ["incomplete_expired", false, { standing: "ended", endedReason: "provider_ended" }],
    ["paused", false, { standing: "ended", endedReason: "provider_ended" }],
    ["incomplete", false, "ignore"],
  ];
  for (const [status, cancelAtPeriodEnd, expected] of cases) {
    test(`${status}${cancelAtPeriodEnd ? " (cancel at period end)" : ""}`, () => {
      expect(standingOf(status, cancelAtPeriodEnd)).toEqual(expected);
    });
  }

  test("an unknown status fails loudly", () => {
    expect(() => standingOf("frozen", false)).toThrow('Unmapped Stripe subscription status "frozen"');
  });
});

describe("price lookup keys", () => {
  test("one per plan and interval, and they parse back", () => {
    const keys = (["starter", "pro"] as const).flatMap((plan) =>
      (["month", "year"] as const).map((interval) => priceLookupKey(plan, interval))
    );
    expect(keys).toEqual(["woofx3_starter_month", "woofx3_starter_year", "woofx3_pro_month", "woofx3_pro_year"]);
    expect(keys.map(parsePriceLookupKey)).toEqual([
      { plan: "starter", interval: "month" },
      { plan: "starter", interval: "year" },
      { plan: "pro", interval: "month" },
      { plan: "pro", interval: "year" },
    ]);
  });

  test("other prices are not tiers", () => {
    expect(parsePriceLookupKey("woofx3_enterprise_month")).toBeNull();
    expect(parsePriceLookupKey("module_1234")).toBeNull();
    expect(parsePriceLookupKey(null)).toBeNull();
  });
});

describe("discount to coupon", () => {
  const cases: Array<[string, DiscountSpec, Partial<Stripe.CouponCreateParams>]> = [
    [
      "percent once",
      { kind: "percent_off", percent: 50, duration: { kind: "once" } },
      { percent_off: 50, duration: "once" },
    ],
    [
      "amount for N months",
      { kind: "amount_off", amountCents: 3000, currency: "usd", duration: { kind: "months", months: 3 } },
      { amount_off: 3000, currency: "usd", duration: "repeating", duration_in_months: 3 },
    ],
    [
      "percent forever",
      { kind: "percent_off", percent: 100, duration: { kind: "forever" } },
      { percent_off: 100, duration: "forever" },
    ],
  ];
  for (const [name, spec, expected] of cases) {
    test(name, () => {
      expect(couponParams("spring", spec)).toEqual({ id: "woofx3_spring", ...expected });
    });
    test(`${name} reads back as the same spec`, () => {
      const params = couponParams("spring", spec);
      const coupon: CouponFields = {
        percent_off: params.percent_off ?? null,
        amount_off: params.amount_off ?? null,
        currency: params.currency ?? null,
        duration: params.duration,
        duration_in_months: params.duration_in_months ?? null,
      };
      expect(specOfCoupon(coupon)).toEqual(spec);
    });
  }

  test("the coupon id is deterministic and refuses unsafe keys", () => {
    expect(couponId("referral-pro-month")).toBe(couponId("referral-pro-month"));
    expect(() => couponId("Has Spaces")).toThrow('Discount key "Has Spaces"');
  });

  test("refuses amounts Stripe would reject", () => {
    expect(() => couponParams("x", { kind: "percent_off", percent: 0, duration: { kind: "once" } })).toThrow(
      "percent_off must be in (0, 100]"
    );
    expect(() =>
      couponParams("x", { kind: "amount_off", amountCents: 1.5, currency: "usd", duration: { kind: "once" } })
    ).toThrow("amount_off must be a whole number");
    expect(() =>
      couponParams("x", { kind: "percent_off", percent: 10, duration: { kind: "months", months: 0 } })
    ).toThrow("months must be a whole number");
  });
});

function subscription(overrides: Partial<SubscriptionFields> = {}): SubscriptionFields {
  return {
    id: "sub_1",
    status: "active",
    cancel_at_period_end: false,
    customer: "cus_1",
    metadata: { accountId: "acct_1" },
    discounts: [],
    items: {
      data: [{ price: { id: "price_1", lookup_key: "woofx3_pro_year" }, current_period_end: 1_800_000_000 }],
    },
    ...overrides,
  };
}

describe("toProviderSubscription", () => {
  test("maps plan, interval, standing and period end", () => {
    const mapped = toProviderSubscription(subscription(), 42);
    expect(mapped).toEqual({
      ok: true,
      value: expect.objectContaining({
        accountId: "acct_1",
        customerRef: "cus_1",
        plan: "pro",
        interval: "year",
        standing: "good",
        currentPeriodEnd: 1_800_000_000_000,
        observedAt: 42,
      }),
    });
  });

  test("an unknown price is an error, not a guess", () => {
    const unknown = subscription({
      items: { data: [{ price: { id: "price_x", lookup_key: "other" }, current_period_end: 1 }] },
    });
    expect(toProviderSubscription(unknown, 0)).toMatchObject({ ok: false, error: { code: "unknown_price" } });
  });

  test("a subscription without our org id is refused", () => {
    expect(toProviderSubscription(subscription({ metadata: {} }), 0)).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  test("incomplete is ignored", () => {
    expect(toProviderSubscription(subscription({ status: "incomplete" }), 0)).toEqual({ ok: true, value: null });
  });
});

describe("verifyWebhook", () => {
  const stripe = new Stripe("sk_test_123", { httpClient: Stripe.createFetchHttpClient() });
  const provider = new StripePaymentProvider(stripe, SECRET, () => 0);
  const payload = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_1", object: "subscription" } },
  });

  async function signed(body: string, secret = SECRET): Promise<Headers> {
    const header = await stripe.webhooks.generateTestHeaderStringAsync({
      payload: body,
      secret,
      cryptoProvider: Stripe.createSubtleCryptoProvider(),
    });
    return new Headers({ "stripe-signature": header });
  }

  test("accepts a signed event and names its subscription", async () => {
    expect(await provider.verifyWebhook(payload, await signed(payload))).toEqual({
      ok: true,
      value: {
        kind: "subscription.changed",
        eventId: "evt_1",
        type: "customer.subscription.updated",
        subscriptionRef: "sub_1",
      },
    });
  });

  test("refuses a wrong secret, a tampered body and a missing header", async () => {
    const headers = await signed(payload, "whsec_other");
    expect(await provider.verifyWebhook(payload, headers)).toMatchObject({
      ok: false,
      error: { code: "bad_signature" },
    });
    const good = await signed(payload);
    expect(await provider.verifyWebhook(`${payload} `, good)).toMatchObject({
      ok: false,
      error: { code: "bad_signature" },
    });
    expect(await provider.verifyWebhook(payload, new Headers())).toMatchObject({
      ok: false,
      error: { code: "bad_signature" },
    });
  });

  test("an event about no subscription is ignored", async () => {
    const body = JSON.stringify({ id: "evt_2", object: "event", type: "customer.created", data: { object: {} } });
    expect(await provider.verifyWebhook(body, await signed(body))).toEqual({
      ok: true,
      value: { kind: "ignored", eventId: "evt_2", type: "customer.created" },
    });
  });
});

describe("billing config", () => {
  test("accepts a complete config", () => {
    expect(parsePaymentsConfig(VALID_ENV).BILLING_PROVIDER).toBe("stripe");
  });

  test("names every missing or malformed variable", () => {
    expect(() => parsePaymentsConfig({})).toThrow(
      /BILLING_PROVIDER.*STRIPE_SECRET_KEY.*STRIPE_WEBHOOK_SECRET.*ORG_PORTAL_URL/
    );
    expect(() => parsePaymentsConfig({ ...VALID_ENV, STRIPE_WEBHOOK_SECRET: "nope" })).toThrow("STRIPE_WEBHOOK_SECRET");
    expect(() => parsePaymentsConfig({ ...VALID_ENV, ORG_PORTAL_URL: "http://woofx3.tv/org" })).toThrow(
      "ORG_PORTAL_URL"
    );
    expect(() => parsePaymentsConfig({ ...VALID_ENV, BILLING_PROVIDER: "paypal" })).toThrow("BILLING_PROVIDER");
  });
});
