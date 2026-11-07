import type {
  AppliedDiscount,
  CheckoutRequest,
  DiscountSpec,
  Invoice,
  PaymentEvent,
  PaymentProvider,
  ProviderSubscription,
  Result,
} from "./provider";
import { err, ok } from "./provider";

/**
 * An in-memory PaymentProvider for tests. Tests set what the provider holds
 * (`subscriptions`, `promotionCodes`) and read what was asked of it (`calls`).
 * A webhook body is a JSON PaymentEvent and its signature header must be
 * `x-fake-signature: valid`.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly id = "stripe" as const;
  /** A subscription set to null reads as nothing to apply (still incomplete, or another purpose's). */
  readonly subscriptions = new Map<string, ProviderSubscription | null>();
  readonly promotionCodes = new Map<string, AppliedDiscount>();
  /** Each customer's invoices, newest first. */
  readonly invoices = new Map<string, Invoice[]>();
  readonly calls: Array<{ method: string; args: unknown }> = [];
  /** Checkout sessions opened, by idempotency key. */
  readonly checkouts = new Map<string, { request: CheckoutRequest; url: string }>();
  /** When set, every call fails with this. */
  outage: Result<never> | null = null;

  async createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>> {
    this.calls.push({ method: "createCheckout", args: req });
    if (this.outage) {
      return this.outage;
    }
    // Like Stripe: a repeated idempotency key replays the first session, or is refused when the parameters differ.
    const opened = this.checkouts.get(req.idempotencyKey);
    if (opened !== undefined) {
      return JSON.stringify(opened.request) === JSON.stringify(req)
        ? ok({ url: opened.url })
        : err("checkout_in_progress", `Key ${req.idempotencyKey} is open with other parameters`);
    }
    const { purpose } = req;
    const url = `https://checkout.example/${purpose.accountId}/${purpose.plan}_${purpose.interval}/${this.checkouts.size + 1}`;
    this.checkouts.set(req.idempotencyKey, { request: req, url });
    return ok({ url });
  }

  async createPortalSession(req: { customerRef: string; returnUrl: string }): Promise<Result<{ url: string }>> {
    this.calls.push({ method: "createPortalSession", args: req });
    return this.outage ?? ok({ url: `https://portal.example/${req.customerRef}` });
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<Result<PaymentEvent>> {
    if (headers.get("x-fake-signature") !== "valid") {
      return err("bad_signature", "fake signature mismatch");
    }
    return ok(JSON.parse(rawBody) as PaymentEvent);
  }

  async fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription | null>> {
    this.calls.push({ method: "fetchSubscription", args: subscriptionRef });
    if (this.outage) {
      return this.outage;
    }
    const subscription = this.subscriptions.get(subscriptionRef);
    return subscription === undefined
      ? err("invalid_request", `No fake subscription ${subscriptionRef}`)
      : ok(subscription);
  }

  async applyDiscount(req: {
    subscriptionRef: string;
    key: string;
    spec: DiscountSpec;
    idempotencyKey: string;
  }): Promise<Result<AppliedDiscount>> {
    this.calls.push({ method: "applyDiscount", args: req });
    if (this.outage) {
      return this.outage;
    }
    const subscription = this.subscriptions.get(req.subscriptionRef);
    if (subscription === undefined || subscription === null) {
      return err("invalid_request", `No fake subscription ${req.subscriptionRef}`);
    }
    const applied: AppliedDiscount = { spec: req.spec, code: null, endsAt: null };
    this.subscriptions.set(req.subscriptionRef, { ...subscription, discount: applied });
    return ok(applied);
  }

  async lookupPromotionCode(code: string): Promise<Result<AppliedDiscount | null>> {
    this.calls.push({ method: "lookupPromotionCode", args: code });
    return this.outage ?? ok(this.promotionCodes.get(code) ?? null);
  }

  async listInvoices(customerRef: string, limit: number): Promise<Result<Invoice[]>> {
    this.calls.push({ method: "listInvoices", args: { customerRef, limit } });
    return this.outage ?? ok((this.invoices.get(customerRef) ?? []).slice(0, limit));
  }
}
