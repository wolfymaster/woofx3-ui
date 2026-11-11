import { z } from "zod";

/**
 * Typed facade over the management plane's billing API. Convex asks the plane
 * to do the money things a person triggers (open a checkout or the customer
 * portal, list invoices, check a code); it never calls from a browser or on a
 * read path. The plane owns the payment provider, so nothing here names one.
 *
 * Every command answers a `BillingResult`: a refusal the plane decided, an
 * outage worth retrying, or a transport failure, as data rather than a throw.
 * Uses the same deployment credential as the engine client
 * (`MAINTENANCE_API_URL` / `MAINTENANCE_API_KEY`); the key needs the
 * `billing:read` and `billing:write` scopes.
 */

export const BILLING_CLIENT = {
  // Opening a checkout makes the plane call the payment provider, so it is slower than an engine call.
  requestTimeoutMs: 30_000,
  // Repeated clicks on the same plan within one window share an Idempotency-Key and so one checkout.
  checkoutKeyWindowMs: 30 * 60_000,
} as const;

export const PLAN_TIERS = ["starter", "pro"] as const;
export type BillingTier = (typeof PLAN_TIERS)[number];
export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Decided by the plane for this request and state: asking again gets the same answer. */
export const BILLING_REFUSAL_CODES = [
  "account_not_found",
  "already_subscribed",
  // A failing subscription is mended in the customer portal, which the caller should open.
  "subscription_exists",
  "suspended_by_operator",
  "checkout_in_progress",
  "no_customer",
  "unknown_discount",
  "promotion_code_not_found",
  "checkout_not_found",
  // An operator-exempt org has nothing to buy.
  "exempt",
  "invalid_return_path",
] as const;
export type BillingRefusalCode = (typeof BILLING_REFUSAL_CODES)[number];

/**
 * A dependency of the plane failed; nothing was decided and a retry may succeed.
 * `subscription_not_found` is here because the plane creates the row moments after an org's first
 * managed engine, so asking again soon works.
 */
export const BILLING_OUTAGE_CODES = [
  "payment_unavailable",
  "payment_refused",
  "identity_unavailable",
  "subscription_not_found",
] as const;

/** Failures between Convex and the plane that the plane did not decide. */
export const BILLING_TRANSPORT_CODES = [
  "not_configured",
  "unreachable",
  // The API key was refused or lacks `billing:read` / `billing:write`.
  "unauthorized",
  "bad_request",
  "unexpected_response",
] as const;

export type BillingErrorCode =
  | BillingRefusalCode
  | (typeof BILLING_OUTAGE_CODES)[number]
  | (typeof BILLING_TRANSPORT_CODES)[number];

export type BillingError = { code: BillingErrorCode; message: string };

export type BillingResult<T> = { ok: true; value: T } | { ok: false; error: BillingError };

export function billingOk<T>(value: T): BillingResult<T> {
  return { ok: true, value };
}

export function billingErr<T>(code: BillingErrorCode, message: string): BillingResult<T> {
  return { ok: false, error: { code, message } };
}

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([...BILLING_REFUSAL_CODES, ...BILLING_OUTAGE_CODES]);

const durationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once") }),
  z.object({ kind: z.literal("months"), months: z.number() }),
  z.object({ kind: z.literal("forever") }),
]);
export type DiscountDuration = z.infer<typeof durationSchema>;

const appliedDiscountSchema = z.object({
  spec: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("percent_off"), percent: z.number(), duration: durationSchema }),
    z.object({
      kind: z.literal("amount_off"),
      amountCents: z.number(),
      currency: z.literal("usd"),
      duration: durationSchema,
    }),
  ]),
  code: z.string().nullable(),
  /** Epoch milliseconds. */
  endsAt: z.number().nullable(),
});
export type AppliedDiscount = z.infer<typeof appliedDiscountSchema>;

export const INVOICE_STATUSES = ["draft", "open", "paid", "uncollectible", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

const invoiceWireSchema = z.object({
  id: z.string(),
  periodStart: z.string(),
  amountCents: z.number(),
  status: z.enum(INVOICE_STATUSES),
  hostedUrl: z.string().nullable(),
});

export interface Invoice {
  id: string;
  /** Epoch milliseconds. */
  periodStart: number;
  amountCents: number;
  status: InvoiceStatus;
  /** The payment page for the invoice; null while it is a draft. */
  hostedUrl: string | null;
}

/** `needs_review` is a module purchase that was paid but could not be granted; support settles it. */
export const CHECKOUT_STATES = ["open", "awaiting_payment", "complete", "expired", "needs_review"] as const;
export type CheckoutState = (typeof CHECKOUT_STATES)[number];

export interface CheckoutView {
  id: string;
  /** The Convex organization id the checkout was opened for. */
  accountId: string;
  state: CheckoutState;
}

const checkoutOpenedSchema = z.object({ url: z.string(), checkoutId: z.string() });
const urlSchema = z.object({ url: z.string() });
const ensureSchema = z.object({ accountId: z.string(), version: z.number() });
const invoicesSchema = z.object({ invoices: z.array(invoiceWireSchema) });
const checkoutViewSchema = z.object({ id: z.string(), accountId: z.string(), state: z.enum(CHECKOUT_STATES) });

export interface CheckoutRequest {
  accountId: string;
  tier: BillingTier;
  interval: BillingInterval;
  promotionCode?: string;
  /** Stable across retries of one user intent; see `checkoutIdempotencyKey`. */
  idempotencyKey: string;
}

export interface BillingClient {
  /** Starts the org's trial if it has no billing yet. Idempotent. */
  ensure(accountId: string): Promise<BillingResult<{ accountId: string; version: number }>>;
  startCheckout(request: CheckoutRequest): Promise<BillingResult<{ url: string; checkoutId: string }>>;
  /** The plane returns the customer to its billing page; it also accepts a `returnPath`, which no page sends yet. */
  openPortal(accountId: string): Promise<BillingResult<{ url: string }>>;
  listInvoices(accountId: string): Promise<BillingResult<Invoice[]>>;
  /** `null` when no active code by that name exists. */
  lookupPromotionCode(code: string): Promise<BillingResult<AppliedDiscount | null>>;
  /** `accountId` is the org the caller acts for; another org's checkout answers `checkout_not_found`. */
  checkoutState(checkoutId: string, accountId: string): Promise<BillingResult<CheckoutView>>;
}

/** One `ensure` per org ever means one key per org. */
export function ensureIdempotencyKey(accountId: string): string {
  return `ensure:${accountId}`;
}

/**
 * Requests for the same org and terms inside one window share a key, so the
 * plane answers a double click or a retry with the one checkout the first
 * opened; other terms or a later window get a new key.
 */
export async function checkoutIdempotencyKey(
  request: Pick<CheckoutRequest, "accountId" | "tier" | "interval" | "promotionCode">,
  nowMs: number
): Promise<string> {
  const windowStart = Math.floor(nowMs / BILLING_CLIENT.checkoutKeyWindowMs) * BILLING_CLIENT.checkoutKeyWindowMs;
  const code = request.promotionCode ?? "";
  // Hashed past a few characters so a long code cannot push the key over the plane's 255-character limit.
  const codePart = code.length <= MAX_INLINE_CODE_LENGTH ? encodeURIComponent(code) : `sha256-${await sha256Hex(code)}`;
  return `checkout:${request.accountId}:${request.tier}:${request.interval}:${codePart}:${windowStart}`;
}

/** Longest promotion code kept readable in a checkout key. */
const MAX_INLINE_CODE_LENGTH = 40;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface BillingClientConfig {
  baseUrl: string;
  apiKey: string;
}

/** The deployment's plane credential, or null on a deployment without the service. */
export function billingConfigFromEnv(env: Record<string, string | undefined>): BillingClientConfig | null {
  const baseUrl = env.MAINTENANCE_API_URL;
  const apiKey = env.MAINTENANCE_API_KEY;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

function errorFrom(text: string, status: number): BillingError {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
    const { code, message } = parsed.error ?? {};
    if (typeof code === "string" && typeof message === "string" && KNOWN_CODES.has(code)) {
      return { code: code as BillingErrorCode, message };
    }
  } catch {
    // A proxy's HTML or an empty body: the status alone decides below.
  }
  if (status === 401 || status === 403) {
    return { code: "unauthorized", message: "The billing service refused this deployment's credential." };
  }
  if (status === 400) {
    return { code: "bad_request", message: "The billing service rejected the request." };
  }
  if (status === 502 || status === 503) {
    return { code: "payment_unavailable", message: "Billing is unavailable; retry later." };
  }
  return { code: "unexpected_response", message: `The billing service answered ${status}.` };
}

interface Call {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

/** The facade over HTTP. Built per action call; it holds no state beyond its credential. */
export class HttpBillingClient implements BillingClient {
  constructor(private readonly config: BillingClientConfig) {}

  ensure(accountId: string) {
    return this.send(
      {
        method: "POST",
        path: `/v1/billing/accounts/${encodeURIComponent(accountId)}/ensure`,
        idempotencyKey: ensureIdempotencyKey(accountId),
      },
      ensureSchema
    );
  }

  startCheckout(request: CheckoutRequest) {
    return this.send(
      {
        method: "POST",
        path: `/v1/billing/accounts/${encodeURIComponent(request.accountId)}/checkouts`,
        idempotencyKey: request.idempotencyKey,
        body: { plan: request.tier, interval: request.interval, promotionCode: request.promotionCode ?? null },
      },
      checkoutOpenedSchema
    );
  }

  openPortal(accountId: string) {
    return this.send(
      { method: "POST", path: `/v1/billing/accounts/${encodeURIComponent(accountId)}/portal-sessions` },
      urlSchema
    );
  }

  async listInvoices(accountId: string) {
    const result = await this.send(
      { method: "GET", path: `/v1/billing/accounts/${encodeURIComponent(accountId)}/invoices` },
      invoicesSchema
    );
    if (!result.ok) {
      return result;
    }
    return billingOk(
      result.value.invoices.map((invoice) => ({ ...invoice, periodStart: Date.parse(invoice.periodStart) }))
    );
  }

  async lookupPromotionCode(code: string) {
    const result = await this.send(
      { method: "GET", path: `/v1/billing/promotion-codes/${encodeURIComponent(code.trim())}` },
      appliedDiscountSchema
    );
    if (!result.ok && result.error.code === "promotion_code_not_found") {
      return billingOk(null);
    }
    return result;
  }

  checkoutState(checkoutId: string, accountId: string) {
    return this.send(
      {
        method: "GET",
        path: `/v1/billing/checkouts/${encodeURIComponent(checkoutId)}?accountId=${encodeURIComponent(accountId)}`,
      },
      checkoutViewSchema
    );
  }

  private async send<S extends z.ZodType>(call: Call, schema: S): Promise<BillingResult<z.infer<S>>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.apiKey}` };
    if (call.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (call.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = call.idempotencyKey;
    }
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${this.config.baseUrl}${call.path}`, {
        method: call.method,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
        signal: AbortSignal.timeout(BILLING_CLIENT.requestTimeoutMs),
      });
      text = await response.text();
    } catch {
      return billingErr("unreachable", "The billing service did not answer.");
    }
    if (!response.ok) {
      return { ok: false, error: errorFrom(text, response.status) };
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return billingErr("unexpected_response", "The billing service answered with something that is not JSON.");
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return billingErr(
        "unexpected_response",
        `The billing service answered an unexpected shape: ${parsed.error.message}`
      );
    }
    return billingOk(parsed.data);
  }
}

/**
 * The deployment's client, or null when the plane is not configured. Called
 * from an action handler, which is the composition root: no process outlives
 * one call to hold a shared client.
 */
export function billingClientFromEnv(): BillingClient | null {
  const config = billingConfigFromEnv(process.env);
  return config === null ? null : new HttpBillingClient(config);
}
