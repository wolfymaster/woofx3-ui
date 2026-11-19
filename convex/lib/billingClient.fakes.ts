import {
  type AppliedDiscount,
  type BillingClient,
  type BillingInterval,
  type BillingResult,
  type BillingTier,
  billingOk,
  type CheckoutRequest,
  type CheckoutView,
  type Invoice,
  type MarketplaceCheckoutRequest,
  type PlanChangeOutcome,
  type PlanChangePreview,
  type PlanPrice,
  type ScheduledPlanChange,
  type Sponsorship,
  type SponsorshipCheckoutRequest,
  type SponsorshipCheckoutView,
  type SponsorshipTerms,
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
    | "previewPlanChange"
    | "changePlan"
    | "scheduledPlanChange"
    | "lookupPromotionCode"
    | "checkoutState"
    | "planPrices"
    | "sponsorshipTerms"
    | "startSponsorshipCheckout"
    | "listSponsorships"
    | "changeSponsorshipAmount"
    | "cancelSponsorship"
    | "sponsorshipPaymentMethodSession"
    | "sponsorshipCheckoutState";
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
  previewAnswer: BillingResult<PlanChangePreview> = billingOk({
    timing: "now",
    effectiveAt: 0,
    currency: "usd",
    lines: [],
    dueNowCents: 0,
    next: { amountCents: 2_000, at: 0 },
  });
  changeAnswer: BillingResult<PlanChangeOutcome> = billingOk({ kind: "applied" });
  scheduledAnswer: BillingResult<ScheduledPlanChange | null> = billingOk(null);
  promotionAnswer: BillingResult<AppliedDiscount | null> = billingOk(null);
  checkoutStateAnswer: BillingResult<CheckoutView> | null = null;
  pricesAnswer: BillingResult<PlanPrice[]> = billingOk([
    { plan: "starter", interval: "month", amountCents: 1_000, currency: "usd" },
    { plan: "starter", interval: "year", amountCents: 10_000, currency: "usd" },
    { plan: "pro", interval: "month", amountCents: 2_000, currency: "usd" },
    { plan: "pro", interval: "year", amountCents: 20_000, currency: "usd" },
  ]);
  termsAnswer: BillingResult<SponsorshipTerms> = billingOk({
    minCents: 10_000,
    maxCents: 100_000_000,
    currency: "usd",
  });
  sponsorshipsAnswer: BillingResult<Sponsorship[]> = billingOk([]);
  sponsorshipChangeAnswer: BillingResult<null> = billingOk(null);
  sponsorshipCheckoutStateAnswer: BillingResult<SponsorshipCheckoutView> | null = null;

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

  async previewPlanChange(accountId: string, target: { plan: BillingTier; interval: BillingInterval }) {
    this.calls.push({ command: "previewPlanChange", args: [accountId, target] });
    return this.previewAnswer;
  }

  async changePlan(accountId: string, target: { plan: BillingTier; interval: BillingInterval }) {
    this.calls.push({ command: "changePlan", args: [accountId, target] });
    return this.changeAnswer;
  }

  async scheduledPlanChange(accountId: string) {
    this.calls.push({ command: "scheduledPlanChange", args: [accountId] });
    return this.scheduledAnswer;
  }

  async lookupPromotionCode(code: string) {
    this.calls.push({ command: "lookupPromotionCode", args: [code] });
    return this.promotionAnswer;
  }

  async checkoutState(checkoutId: string, accountId: string) {
    this.calls.push({ command: "checkoutState", args: [checkoutId, accountId] });
    return this.checkoutStateAnswer ?? billingOk({ id: checkoutId, accountId, state: "open" as const });
  }

  async planPrices() {
    this.calls.push({ command: "planPrices", args: [] });
    return this.pricesAnswer;
  }

  async sponsorshipTerms() {
    this.calls.push({ command: "sponsorshipTerms", args: [] });
    return this.termsAnswer;
  }

  async startSponsorshipCheckout(request: SponsorshipCheckoutRequest) {
    this.calls.push({ command: "startSponsorshipCheckout", args: [request] });
    return this.checkoutAnswer;
  }

  async listSponsorships(userId: string) {
    this.calls.push({ command: "listSponsorships", args: [userId] });
    return this.sponsorshipsAnswer;
  }

  async changeSponsorshipAmount(userId: string, sponsorshipId: string, amountCents: number) {
    this.calls.push({ command: "changeSponsorshipAmount", args: [userId, sponsorshipId, amountCents] });
    return this.sponsorshipChangeAnswer;
  }

  async cancelSponsorship(userId: string, sponsorshipId: string, atPeriodEnd: boolean) {
    this.calls.push({ command: "cancelSponsorship", args: [userId, sponsorshipId, atPeriodEnd] });
    return this.sponsorshipChangeAnswer;
  }

  async sponsorshipPaymentMethodSession(userId: string, sponsorshipId: string, returnUrl: string) {
    this.calls.push({ command: "sponsorshipPaymentMethodSession", args: [userId, sponsorshipId, returnUrl] });
    return this.portalAnswer;
  }

  async sponsorshipCheckoutState(checkoutId: string, userId: string) {
    this.calls.push({ command: "sponsorshipCheckoutState", args: [checkoutId, userId] });
    return this.sponsorshipCheckoutStateAnswer ?? billingOk({ id: checkoutId, state: "open" as const });
  }
}
