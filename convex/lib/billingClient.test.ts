import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ConvexError } from "convex/values";
import { billingConvexError } from "../billingCommands";
import {
  BILLING_CLIENT,
  billingConfigFromEnv,
  checkoutIdempotencyKey,
  ensureIdempotencyKey,
  HttpBillingClient,
  marketplaceCheckoutIdempotencyKey,
} from "./billingClient";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function plane(status: number, body: unknown): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return seen;
}

const client = new HttpBillingClient({ baseUrl: "https://plane.test", apiKey: "key" });
const TERMS = { accountId: "acc1", tier: "pro", interval: "year", promotionCode: "SAVE" } as const;

describe("idempotency keys", () => {
  const WINDOW = BILLING_CLIENT.checkoutKeyWindowMs;

  test("ensure is one key per org", () => {
    expect(ensureIdempotencyKey("acc1")).toBe("ensure:acc1");
  });

  test("a checkout key is stable inside a window and across retries", async () => {
    const start = 5 * WINDOW;
    expect(await checkoutIdempotencyKey(TERMS, start)).toBe(await checkoutIdempotencyKey(TERMS, start + WINDOW - 1));
  });

  test.each([
    ["the next window", { ...TERMS }, 6 * WINDOW],
    ["another plan", { ...TERMS, tier: "starter" as const }, 5 * WINDOW],
    ["another interval", { ...TERMS, interval: "month" as const }, 5 * WINDOW],
    ["another code", { ...TERMS, promotionCode: "OTHER" }, 5 * WINDOW],
    ["another org", { ...TERMS, accountId: "acc2" }, 5 * WINDOW],
  ])("differs for %s", async (_name, terms, at) => {
    expect(await checkoutIdempotencyKey(terms, at)).not.toBe(await checkoutIdempotencyKey(TERMS, 5 * WINDOW));
  });
});

describe("long promotion codes", () => {
  const long = { ...TERMS, promotionCode: "X".repeat(500) };

  test("keep the key under 255 characters and stable across retries", async () => {
    const key = await checkoutIdempotencyKey(long, 0);
    expect(key.length).toBeLessThan(255);
    expect(await checkoutIdempotencyKey(long, 1)).toBe(key);
  });

  test("still tell two long codes apart", async () => {
    const other = { ...long, promotionCode: `${long.promotionCode}Y` };
    expect(await checkoutIdempotencyKey(other, 0)).not.toBe(await checkoutIdempotencyKey(long, 0));
  });
});

describe("config", () => {
  test("needs both variables and trims trailing slashes", () => {
    expect(billingConfigFromEnv({ MAINTENANCE_API_URL: "https://p.test//" })).toBeNull();
    expect(billingConfigFromEnv({ MAINTENANCE_API_URL: "https://p.test//", MAINTENANCE_API_KEY: "k" })).toEqual({
      baseUrl: "https://p.test",
      apiKey: "k",
    });
  });
});

describe("requests", () => {
  test("startCheckout sends the plane's body, bearer key and Idempotency-Key", async () => {
    const seen = plane(200, { url: "https://pay.example/1", checkoutId: "c1" });
    const result = await client.startCheckout({ ...TERMS, idempotencyKey: "k1" });
    expect(result).toEqual({ ok: true, value: { url: "https://pay.example/1", checkoutId: "c1" } });
    expect(seen[0]).toMatchObject({
      url: "https://plane.test/v1/billing/accounts/acc1/checkouts",
      method: "POST",
      headers: { authorization: "Bearer key", "idempotency-key": "k1" },
      body: { plan: "pro", interval: "year", promotionCode: "SAVE" },
    });
  });

  test("ensure accepts 201 and 200 alike", async () => {
    const seen = plane(201, { accountId: "acc1", version: 1, plan: "starter" });
    expect(await client.ensure("acc1")).toEqual({ ok: true, value: { accountId: "acc1", version: 1 } });
    expect(seen[0]?.headers["idempotency-key"]).toBe("ensure:acc1");
  });

  test("openPortal sends no key and no body", async () => {
    const seen = plane(200, { url: "https://pay.example/portal" });
    await client.openPortal("acc1");
    expect(seen[0]?.url).toBe("https://plane.test/v1/billing/accounts/acc1/portal-sessions");
    expect(seen[0]?.headers["idempotency-key"]).toBeUndefined();
    expect(seen[0]?.body).toBeUndefined();
  });

  test("invoices come back with epoch-millisecond periods", async () => {
    plane(200, {
      invoices: [
        { id: "in_1", periodStart: "2026-11-01T00:00:00.000Z", amountCents: 3000, status: "paid", hostedUrl: null },
      ],
    });
    expect(await client.listInvoices("acc1")).toEqual({
      ok: true,
      value: [{ id: "in_1", periodStart: Date.UTC(2026, 10, 1), amountCents: 3000, status: "paid", hostedUrl: null }],
    });
  });

  test("startMarketplaceCheckout sends the intent and its Idempotency-Key", async () => {
    const seen = plane(200, { url: "https://pay.example/m", checkoutId: "c9" });
    expect(
      await client.startMarketplaceCheckout({ accountId: "acc1", intentId: "pi_1", idempotencyKey: "k9" })
    ).toEqual({ ok: true, value: { url: "https://pay.example/m", checkoutId: "c9" } });
    expect(seen[0]).toMatchObject({
      url: "https://plane.test/v1/billing/accounts/acc1/marketplace-checkouts",
      method: "POST",
      headers: { "idempotency-key": "k9" },
      body: { intentId: "pi_1" },
    });
  });

  test("a long intent id is hashed into the marketplace checkout key", async () => {
    const window = BILLING_CLIENT.checkoutKeyWindowMs;
    const short = await marketplaceCheckoutIdempotencyKey({ accountId: "acc1", intentId: "pi_1" }, window + 5);
    expect(short).toBe(`marketplace-checkout:acc1:pi_1:${window}`);
    const long = await marketplaceCheckoutIdempotencyKey({ accountId: "acc1", intentId: "x".repeat(255) }, window);
    expect(long).toMatch(/^marketplace-checkout:acc1:sha256-[0-9a-f]{64}:\d+$/);
  });

  test("checkoutState asks for the checkout as the org it is for", async () => {
    const seen = plane(200, { id: "c1", accountId: "acc 1", purposeKind: "marketplace", state: "needs_review" });
    expect(await client.checkoutState("c1", "acc 1")).toEqual({
      ok: true,
      value: { id: "c1", accountId: "acc 1", state: "needs_review" },
    });
    expect(seen[0]?.url).toBe("https://plane.test/v1/billing/checkouts/c1?accountId=acc%201");
  });

  test("an unknown promotion code is null, not an error", async () => {
    const seen = plane(404, { error: { code: "promotion_code_not_found", message: "No active promotion code x." } });
    expect(await client.lookupPromotionCode(" x y ")).toEqual({ ok: true, value: null });
    expect(seen[0]?.url).toBe("https://plane.test/v1/billing/promotion-codes/x%20y");
  });
});

describe("error mapping", () => {
  test.each([
    [409, "already_subscribed"],
    [409, "subscription_exists"],
    [409, "suspended_by_operator"],
    [409, "checkout_in_progress"],
    [409, "no_customer"],
    [404, "subscription_not_found"],
    [503, "payment_unavailable"],
    [502, "payment_refused"],
  ])("%d %s keeps the plane's code", async (status, code) => {
    plane(status, { error: { code, message: "m" } });
    expect(await client.openPortal("acc1")).toEqual({ ok: false, error: { code, message: "m" } });
  });

  test.each([
    [401, "<html>nope</html>", "unauthorized"],
    [403, { error: { code: "forbidden", message: "scope" } }, "unauthorized"],
    [400, "", "bad_request"],
    [503, "<html>", "payment_unavailable"],
    [500, "boom", "unexpected_response"],
  ])("%d with an unknown body is %s", async (status, body, code) => {
    plane(status, body);
    const result = await client.openPortal("acc1");
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  test("an answer of the wrong shape is unexpected_response", async () => {
    plane(200, { nope: true });
    expect(await client.openPortal("acc1")).toMatchObject({ ok: false, error: { code: "unexpected_response" } });
  });

  test("a network failure or timeout is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    expect(await client.openPortal("acc1")).toMatchObject({ ok: false, error: { code: "unreachable" } });
  });

  test("the portal sees friendly wording for every code, never the plane's own", () => {
    const refusal = billingConvexError({ code: "suspended_by_operator", message: "plane words" });
    expect(refusal).toBeInstanceOf(ConvexError);
    expect(refusal.data).toEqual({
      code: "suspended_by_operator",
      message: "Your organization's account is suspended. Contact woofx3 support.",
    });
    for (const code of ["subscription_not_found", "unreachable", "payment_unavailable"] as const) {
      const { message } = billingConvexError({ code, message: "plane words" }).data;
      expect(message).toMatch(/try again/i);
    }
    expect(billingConvexError({ code: "exempt", message: "plane words" }).data.message).toMatch(/complimentary/);
    expect(billingConvexError({ code: "unexpected_response", message: "answered 409" }).data.message).not.toContain(
      "409"
    );
  });

  test("a refusal code the client does not know becomes unexpected_response", async () => {
    plane(409, { error: { code: "brand_new_refusal", message: "plane words" } });
    expect(await client.openPortal("acc1")).toMatchObject({ ok: false, error: { code: "unexpected_response" } });
  });

  test("an unreachable plane's error carries no fetch internals", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1");
    }) as typeof fetch;
    const result = await client.openPortal("acc1");
    expect(JSON.stringify(result)).not.toContain("ECONNREFUSED");
  });
});

describe("boundary", () => {
  const sources = ["billingClient.ts", "billingClient.fakes.ts", "../billingCommands.ts"].map((file) =>
    readFileSync(new URL(file, import.meta.url), "utf8")
  );

  test("the billing path names no payment provider", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/stripe/i);
    }
  });
});
