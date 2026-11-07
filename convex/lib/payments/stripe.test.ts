import { describe, expect, test } from "bun:test";
import Stripe from "stripe";
import type { Id } from "../../_generated/dataModel";
import { parsePaymentsConfig } from "./config";
import type { DiscountSpec } from "./provider";
import {
  type CouponFields,
  couponId,
  couponParams,
  type InvoiceFields,
  parsePriceLookupKey,
  priceLookupKey,
  StripePaymentProvider,
  type SubscriptionFields,
  sameDiscount,
  specOfCoupon,
  standingOf,
  toInvoice,
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
    metadata: { purpose: "subscription", ref: "acct_1" },
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

  test("a subscription purpose without our org id is refused", () => {
    expect(toProviderSubscription(subscription({ metadata: { purpose: "subscription" } }), 0)).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  test("a subscription another purpose created, or none of ours, is not applied", () => {
    for (const metadata of [{}, { purpose: "marketplace", ref: "acct_1" }]) {
      expect(toProviderSubscription(subscription({ metadata }), 0)).toEqual({ ok: true, value: null });
    }
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
    data: { object: { id: "sub_1", object: "subscription", metadata: { purpose: "subscription", ref: "acct_1" } } },
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
        eventId: "evt_1",
        type: "customer.subscription.updated",
        purpose: "subscription",
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
      value: { eventId: "evt_2", type: "customer.created", purpose: null, subscriptionRef: null },
    });
  });

  test("an invoice carries its subscription's purpose", async () => {
    const body = JSON.stringify({
      id: "evt_3",
      object: "event",
      type: "invoice.paid",
      data: {
        object: {
          object: "invoice",
          parent: { subscription_details: { subscription: "sub_1", metadata: { purpose: "subscription" } } },
        },
      },
    });
    expect(await provider.verifyWebhook(body, await signed(body))).toMatchObject({
      ok: true,
      value: { purpose: "subscription", subscriptionRef: "sub_1" },
    });
  });

  test("a payment-mode checkout from another purpose names no subscription and no purpose we know", async () => {
    const body = JSON.stringify({
      id: "evt_4",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          mode: "payment",
          subscription: null,
          metadata: { purpose: "marketplace", ref: "listing_1" },
        },
      },
    });
    expect(await provider.verifyWebhook(body, await signed(body))).toEqual({
      ok: true,
      value: { eventId: "evt_4", type: "checkout.session.completed", purpose: null, subscriptionRef: null },
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

describe("purpose metadata", () => {
  /** A Stripe client whose requests are recorded and answered from `answers`, keyed by path. */
  function recordingStripe(answers: Record<string, unknown>) {
    const requests: Array<{ path: string; body: URLSearchParams; idempotencyKey: string | null }> = [];
    const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      requests.push({
        path: url.pathname,
        body: new URLSearchParams(String(init?.body ?? "")),
        idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
      });
      const answer = answers[url.pathname];
      if (answer instanceof Response) {
        return answer;
      }
      return answer === undefined
        ? new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing" } }), {
            status: 404,
          })
        : new Response(JSON.stringify(answer), { status: 200 });
    };
    const stripe = new Stripe("sk_test_123", {
      httpClient: Stripe.createFetchHttpClient(fetchFn as typeof fetch),
      maxNetworkRetries: 0,
    });
    return { provider: new StripePaymentProvider(stripe, SECRET, () => 0), requests };
  }

  test("a subscription checkout stamps its purpose and org on the session and the subscription", async () => {
    const { provider, requests } = recordingStripe({
      "/v1/prices": { object: "list", data: [{ id: "price_pro_month", object: "price" }] },
      "/v1/checkout/sessions": { id: "cs_1", object: "checkout.session", url: "https://checkout.stripe.test/cs_1" },
    });
    const result = await provider.createCheckout({
      purpose: {
        kind: "subscription",
        accountId: "acct_1" as Id<"accounts">,
        plan: "pro",
        interval: "month",
        promotionCode: null,
      },
      customerRef: null,
      allowPromotionCodes: true,
      successUrl: "https://woofx3.tv/org/billing?checkout=done",
      cancelUrl: "https://woofx3.tv/org/billing",
      idempotencyKey: "checkout:acct_1:1",
      expiresAt: 1_800_003_600_000,
    });
    expect(result).toEqual({ ok: true, value: { url: "https://checkout.stripe.test/cs_1" } });
    const session = requests.find((request) => request.path === "/v1/checkout/sessions")?.body;
    expect(session?.get("metadata[purpose]")).toBe("subscription");
    expect(session?.get("metadata[ref]")).toBe("acct_1");
    expect(session?.get("subscription_data[metadata][purpose]")).toBe("subscription");
    expect(session?.get("subscription_data[metadata][ref]")).toBe("acct_1");
    expect(session?.get("client_reference_id")).toBe("acct_1");
    expect(session?.get("expires_at")).toBe("1800003600");
    expect(requests.find((request) => request.path === "/v1/checkout/sessions")?.idempotencyKey).toBe(
      "checkout:acct_1:1"
    );
  });

  test("a key already used for another open checkout is checkout_in_progress", async () => {
    const { provider } = recordingStripe({
      "/v1/prices": { object: "list", data: [{ id: "price_pro_month", object: "price" }] },
      "/v1/checkout/sessions": new Response(
        JSON.stringify({
          error: {
            type: "idempotency_error",
            message: "Keys for idempotent requests can only be used with the same parameters",
          },
        }),
        { status: 400 }
      ),
    });
    const result = await provider.createCheckout({
      purpose: {
        kind: "subscription",
        accountId: "acct_1" as Id<"accounts">,
        plan: "starter",
        interval: "year",
        promotionCode: null,
      },
      customerRef: null,
      allowPromotionCodes: true,
      successUrl: "https://woofx3.tv/org/billing?checkout=done",
      cancelUrl: "https://woofx3.tv/org/billing",
      idempotencyKey: "checkout:acct_1:1",
      expiresAt: 1_800_003_600_000,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "checkout_in_progress" } });
  });

  test("a coupon created for a discount carries the purpose and our discount key", async () => {
    const { provider, requests } = recordingStripe({
      "/v1/coupons": { id: "woofx3_spring", object: "coupon" },
      "/v1/subscriptions/sub_1": {
        id: "sub_1",
        object: "subscription",
        discounts: [
          {
            object: "discount",
            end: null,
            promotion_code: null,
            source: { coupon: { percent_off: 20, amount_off: null, currency: null, duration: "once" } },
          },
        ],
      },
    });
    const spec: DiscountSpec = { kind: "percent_off", percent: 20, duration: { kind: "once" } };
    const result = await provider.applyDiscount({ subscriptionRef: "sub_1", key: "spring", spec, idempotencyKey: "k" });
    expect(result).toMatchObject({ ok: true, value: { spec } });
    const coupon = requests.find((request) => request.path === "/v1/coupons")?.body;
    expect(coupon?.get("metadata[purpose]")).toBe("subscription");
    expect(coupon?.get("metadata[ref]")).toBe("spring");
  });

  test("an existing coupon with other terms under the same key is refused, not silently reused", async () => {
    const { provider, requests } = recordingStripe({
      "/v1/coupons/woofx3_spring": {
        id: "woofx3_spring",
        object: "coupon",
        percent_off: 20,
        amount_off: null,
        currency: null,
        duration: "once",
      },
    });
    const spec: DiscountSpec = { kind: "percent_off", percent: 50, duration: { kind: "once" } };
    const result = await provider.applyDiscount({ subscriptionRef: "sub_1", key: "spring", spec, idempotencyKey: "k" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(requests.map((request) => request.path)).toEqual(["/v1/coupons/woofx3_spring"]);
  });
});

describe("sameDiscount", () => {
  const twentyOnce: DiscountSpec = { kind: "percent_off", percent: 20, duration: { kind: "once" } };
  const cases: Array<[string, DiscountSpec | null, boolean]> = [
    ["the same terms", { kind: "percent_off", percent: 20, duration: { kind: "once" } }, true],
    ["another percent", { kind: "percent_off", percent: 25, duration: { kind: "once" } }, false],
    ["another duration", { kind: "percent_off", percent: 20, duration: { kind: "forever" } }, false],
    ["an amount instead", { kind: "amount_off", amountCents: 20, currency: "usd", duration: { kind: "once" } }, false],
    ["a coupon we can't read", null, false],
  ];
  for (const [name, existing, expected] of cases) {
    test(name, () => {
      expect(sameDiscount(existing, twentyOnce)).toBe(expected);
    });
  }
  test("months must match", () => {
    const three: DiscountSpec = {
      kind: "amount_off",
      amountCents: 500,
      currency: "usd",
      duration: { kind: "months", months: 3 },
    };
    expect(sameDiscount(three, three)).toBe(true);
    expect(sameDiscount({ ...three, duration: { kind: "months", months: 6 } }, three)).toBe(false);
  });
});

describe("toInvoice", () => {
  const invoice = (overrides: Partial<InvoiceFields> = {}): InvoiceFields => ({
    id: "in_1",
    status: "paid",
    period_start: 1_800_000_000,
    total: 3000,
    hosted_invoice_url: "https://invoice.stripe.com/i/1",
    ...overrides,
  });

  const cases: Array<[string, Partial<InvoiceFields>, unknown]> = [
    [
      "a paid invoice",
      {},
      {
        ok: true,
        value: {
          id: "in_1",
          periodStart: 1_800_000_000_000,
          amountCents: 3000,
          status: "paid",
          hostedUrl: "https://invoice.stripe.com/i/1",
        },
      },
    ],
    ["an unsaved draft", { status: null, hosted_invoice_url: null }, expect.objectContaining({ ok: true })],
    ["an unknown status", { status: "mystery" }, expect.objectContaining({ ok: false })],
  ];
  for (const [name, overrides, expected] of cases) {
    test(name, () => {
      expect(toInvoice(invoice(overrides))).toEqual(expected);
    });
  }

  test("an unsaved draft reads as a draft with no page", () => {
    const mapped = toInvoice(invoice({ status: null, hosted_invoice_url: undefined }));
    expect(mapped.ok && mapped.value).toEqual(expect.objectContaining({ status: "draft", hostedUrl: null }));
  });
});
