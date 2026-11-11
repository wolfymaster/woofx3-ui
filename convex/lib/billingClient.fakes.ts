import {
  type AppliedDiscount,
  type BillingClient,
  type BillingResult,
  billingOk,
  type CheckoutRequest,
  type CheckoutView,
  type Invoice,
  type MarketplaceCheckoutRequest,
} from "./billingClient";

// A scripted BillingClient for tests. The second dot in the file name keeps
// Convex from deploying it, as it does for *.test.ts.

export interface BillingCall {
  command:
    | "ensure"
    | "startCheckout"
    | "startMarketplaceCheckout"
    | "openPortal"
    | "listInvoices"
    | "lookupPromotionCode"
    | "checkoutState";
  args: unknown[];
}

/** Answers every command with a plausible success unless a field is set; records each call. */
export class FakeBillingClient implements BillingClient {
  readonly calls: BillingCall[] = [];
  ensureAnswer: BillingResult<{ accountId: string; version: number }> | null = null;
  checkoutAnswer: BillingResult<{ url: string; checkoutId: string }> = billingOk({
    url: "https://pay.example/c/1",
    checkoutId: "11111111-1111-4111-8111-111111111111",
  });
  portalAnswer: BillingResult<{ url: string }> = billingOk({ url: "https://pay.example/portal" });
  invoicesAnswer: BillingResult<Invoice[]> = billingOk([]);
  promotionAnswer: BillingResult<AppliedDiscount | null> = billingOk(null);
  checkoutStateAnswer: BillingResult<CheckoutView> | null = null;

  async ensure(accountId: string) {
    this.calls.push({ command: "ensure", args: [accountId] });
    return this.ensureAnswer ?? billingOk({ accountId, version: 1 });
  }

  async startCheckout(request: CheckoutRequest) {
    this.calls.push({ command: "startCheckout", args: [request] });
    return this.checkoutAnswer;
  }

  async startMarketplaceCheckout(request: MarketplaceCheckoutRequest) {
    this.calls.push({ command: "startMarketplaceCheckout", args: [request] });
    return this.checkoutAnswer;
  }

  async openPortal(accountId: string) {
    this.calls.push({ command: "openPortal", args: [accountId] });
    return this.portalAnswer;
  }

  async listInvoices(accountId: string) {
    this.calls.push({ command: "listInvoices", args: [accountId] });
    return this.invoicesAnswer;
  }

  async lookupPromotionCode(code: string) {
    this.calls.push({ command: "lookupPromotionCode", args: [code] });
    return this.promotionAnswer;
  }

  async checkoutState(checkoutId: string, accountId: string) {
    this.calls.push({ command: "checkoutState", args: [checkoutId, accountId] });
    return this.checkoutStateAnswer ?? billingOk({ id: checkoutId, accountId, state: "open" as const });
  }
}
