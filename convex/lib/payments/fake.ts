import type {
  AppliedDiscount,
  PaymentEvent,
  PaymentProvider,
  CheckoutRequest,
  DiscountSpec,
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
  readonly subscriptions = new Map<string, ProviderSubscription>();
  readonly promotionCodes = new Map<string, AppliedDiscount>();
  readonly calls: Array<{ method: string; args: unknown }> = [];
  /** When set, every call fails with this. */
  outage: Result<never> | null = null;

  async createCheckout(req: CheckoutRequest): Promise<Result<{ url: string }>> {
    this.calls.push({ method: "createCheckout", args: req });
    return this.outage ?? ok({ url: `https://checkout.example/${req.accountId}/${req.plan}_${req.interval}` });
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

  async fetchSubscription(subscriptionRef: string): Promise<Result<ProviderSubscription>> {
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
    if (subscription === undefined) {
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
}
