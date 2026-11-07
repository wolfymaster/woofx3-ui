import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  CHECKOUT_ATTEMPT,
  checkoutAttempt,
  checkRenewal,
  openSubscriptionCheckout,
  RENEWAL_CHECK_RETRY,
  renewalRetryDelay,
} from "./billing";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { newBackend } from "./lib/convexTest.testing";
import { FAKE_CHECKOUT_AMOUNT_CENTS, FakePaymentProvider } from "./lib/payments/fake";
import { err, type ProviderSubscription, type SessionChange } from "./lib/payments/provider";
import { applyTransition, subscriptionFor } from "./lib/subscriptions";
import { handlePaymentWebhook } from "./paymentsHttp";

type Backend = ReturnType<typeof newBackend>;

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 1);
const SIGNED = new Headers({ "x-fake-signature": "valid" });

async function seedOrg(t: Backend) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const adminId = await ctx.db.insert("users", { name: "Admin" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: ownerId, role: "owner", createdAt: 1 });
    await ctx.db.insert("accountMembers", { accountId, userId: adminId, role: "admin", createdAt: 1 });
    return { accountId, ownerId, adminId };
  });
}

function providerSubscription(
  accountId: Id<"accounts">,
  overrides: Partial<ProviderSubscription> = {}
): ProviderSubscription {
  return {
    customerRef: "cus_1",
    subscriptionRef: "sub_1",
    accountId,
    plan: "pro",
    interval: "month",
    addOns: [],
    standing: "good",
    endedReason: null,
    providerStatus: "active",
    currentPeriodEnd: T0 + 60 * DAY,
    discount: null,
    observedAt: T0 + DAY,
    ...overrides,
  };
}

function deliver(t: Backend, provider: FakePaymentProvider, eventId: string) {
  const body = JSON.stringify({
    eventId,
    type: "invoice.paid",
    purpose: "subscription",
    subscriptionRef: "sub_1",
  });
  return handlePaymentWebhook({ provider, runQuery: t.query, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
}

function deliverAbout(t: Backend, provider: FakePaymentProvider, eventId: string, subscriptionRef: string) {
  const body = JSON.stringify({
    eventId,
    type: "customer.subscription.updated",
    purpose: "subscription",
    subscriptionRef,
  });
  return handlePaymentWebhook({ provider, runQuery: t.query, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
}

const PORTAL = "https://woofx3.tv/org";

function openCheckout(t: Backend, provider: FakePaymentProvider, accountId: Id<"accounts">, nowMs = T0) {
  return openSubscriptionCheckout(
    { provider, runMutation: t.mutation, portalUrl: PORTAL },
    null,
    { accountId, plan: "pro", interval: "month" },
    nowMs
  );
}

function deliverSession(
  t: Backend,
  provider: FakePaymentProvider,
  eventId: string,
  session: SessionChange,
  subscriptionRef: string | null = "sub_1"
) {
  const body = JSON.stringify({
    eventId,
    type: session.change === "expired" ? "checkout.session.expired" : "checkout.session.completed",
    purpose: "subscription",
    subscriptionRef: session.change === "expired" ? null : subscriptionRef,
    session,
  });
  return handlePaymentWebhook({ provider, runQuery: t.query, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
}

/** The newest checkout the fake opened, which a test then pays. */
function lastSessionRef(provider: FakePaymentProvider): string {
  const sessionRef = [...provider.sessionStates.keys()].at(-1);
  if (sessionRef === undefined) {
    throw new Error("no checkout opened");
  }
  return sessionRef;
}

/** Opens a checkout for the org and pays it: the provider's subscription must be set first. */
async function subscribe(
  t: Backend,
  provider: FakePaymentProvider,
  accountId: Id<"accounts">,
  { eventId = "evt_paid", subscriptionRef = "sub_1", nowMs = T0 } = {}
) {
  await openCheckout(t, provider, accountId, nowMs);
  const sessionRef = lastSessionRef(provider);
  provider.sessionStates.set(sessionRef, "complete");
  return deliverSession(t, provider, eventId, { sessionRef, change: "paid" }, subscriptionRef);
}

async function sessions(t: Backend) {
  return t.run(async (ctx) =>
    (await ctx.db.query("paymentSessions").collect()).map((row) => [row.providerSessionId, row.state])
  );
}

async function events(t: Backend) {
  return t.run(async (ctx) => (await ctx.db.query("paymentEvents").collect()).map((e) => [e.eventId, e.outcome]));
}

async function transitions(t: Backend, accountId: Id<"accounts">) {
  return t.run(async (ctx) =>
    (
      await ctx.db
        .query("subscriptionTransitions")
        .withIndex("by_account_at", (q) => q.eq("accountId", accountId))
        .collect()
    ).map((row) => row.event)
  );
}

describe("payments webhook", () => {
  test("a marketplace-style purchase (a payment-mode checkout) is acknowledged and touches no subscription", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await t.run((ctx) =>
      applyTransition(ctx, {
        accountId,
        event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
        now: T0,
        actor: "test",
        origin: "signup",
      })
    );
    const before = await t.run((ctx) => subscriptionFor(ctx, accountId));
    const provider = new FakePaymentProvider();
    // The provider reads the purpose off a session no purpose of ours created: it knows none.
    const body = JSON.stringify({
      eventId: "evt_market",
      type: "checkout.session.completed",
      purpose: null,
      subscriptionRef: null,
    });
    const response = await handlePaymentWebhook(
      { provider, runQuery: t.query, runMutation: t.mutation, now: () => T0 },
      body,
      SIGNED
    );
    expect(response.status).toBe(200);
    expect(await events(t)).toEqual([["evt_market", "ignored"]]);
    expect(provider.calls).toEqual([]);
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toEqual(before);
    expect(await transitions(t, accountId)).toEqual(["TrialStarted"]);
  });

  test("a subscription that reads as nothing to apply is acknowledged", async () => {
    const t = newBackend();
    await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", null);
    expect((await deliver(t, provider, "evt_incomplete")).status).toBe(200);
    expect(await events(t)).toEqual([["evt_incomplete", "ignored"]]);
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
  });

  test("a paid checkout activates the org, mirrors the provider and completes its session", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    expect((await subscribe(t, provider, accountId, { eventId: "evt_1" })).status).toBe(200);
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toMatchObject({
      state: "active",
      plan: "pro",
      interval: "month",
      provider: "stripe",
      providerCustomerId: "cus_1",
      providerSubscriptionId: "sub_1",
      providerStanding: "good",
      nextBillingAt: T0 + 60 * DAY,
    });
    expect(await events(t)).toEqual([["evt_1", "applied"]]);
    const [session] = await t.run((ctx) => ctx.db.query("paymentSessions").collect());
    expect(session).toMatchObject({
      providerSessionId: "cs_fake_1",
      state: "complete",
      ref: accountId,
      amountCents: FAKE_CHECKOUT_AMOUNT_CENTS,
      purpose: { kind: "subscription", accountId, plan: "pro", interval: "month", promotionCode: null },
    });
  });

  test("a subscription no checkout of ours bound is acknowledged and grants nothing", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    expect((await deliver(t, provider, "evt_1")).status).toBe(200);
    expect(await events(t)).toEqual([["evt_1", "ignored"]]);
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
  });

  test("a duplicate delivery changes nothing, nor does a second paid event for the same session", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await subscribe(t, provider, accountId, { eventId: "evt_1" });
    const again = await deliverSession(t, provider, "evt_1", { sessionRef: "cs_fake_1", change: "paid" });
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    await deliverSession(t, provider, "evt_async", { sessionRef: "cs_fake_1", change: "paid" });
    expect(await transitions(t, accountId)).toEqual(["ProviderActivated"]);
    expect(provider.calls.filter((c) => c.method === "fetchSubscription").length).toBe(1);
    expect(await events(t)).toEqual([
      ["evt_1", "applied"],
      ["evt_async", "ignored"],
    ]);
  });

  test("an event about a session we have no row for is acknowledged and ignored", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    const response = await deliverSession(t, provider, "evt_foreign", { sessionRef: "cs_foreign", change: "paid" });
    expect(response.status).toBe(200);
    expect(await events(t)).toEqual([["evt_foreign", "ignored"]]);
    expect(provider.calls.filter((c) => c.method === "fetchSubscription")).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
  });

  test("an expired session is marked expired and a later paid event for it grants nothing", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await openCheckout(t, provider, accountId);
    await deliverSession(t, provider, "evt_expired", { sessionRef: "cs_fake_1", change: "expired" });
    expect(await sessions(t)).toEqual([["cs_fake_1", "expired"]]);
    await deliverSession(t, provider, "evt_late", { sessionRef: "cs_fake_1", change: "paid" });
    expect(await events(t)).toEqual([
      ["evt_expired", "applied"],
      ["evt_late", "ignored"],
    ]);
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
  });

  test("a checkout awaiting a delayed payment grants once the payment succeeds", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await openCheckout(t, provider, accountId);
    await deliverSession(t, provider, "evt_completed", { sessionRef: "cs_fake_1", change: "awaiting_payment" });
    expect(await sessions(t)).toEqual([["cs_fake_1", "open"]]);
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
    await deliverSession(t, provider, "evt_async_paid", { sessionRef: "cs_fake_1", change: "paid" });
    expect(await sessions(t)).toEqual([["cs_fake_1", "complete"]]);
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.state).toBe("active");
  });

  test("a second paid checkout's live subscription is recorded as stray, not silently ignored", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    provider.subscriptions.set("sub_2", providerSubscription(accountId, { subscriptionRef: "sub_2" }));
    await openCheckout(t, provider, accountId);
    // The first session is paid at the provider before the owner opens a second checkout in a new window.
    provider.sessionStates.set("cs_fake_1", "complete");
    await openCheckout(t, provider, accountId, T0 + CHECKOUT_ATTEMPT.windowMs);
    expect(await sessions(t)).toEqual([
      ["cs_fake_1", "open"],
      ["cs_fake_2", "open"],
    ]);
    await deliverSession(t, provider, "evt_s1", { sessionRef: "cs_fake_1", change: "paid" }, "sub_1");
    await deliverSession(t, provider, "evt_s2", { sessionRef: "cs_fake_2", change: "paid" }, "sub_2");
    await deliverAbout(t, provider, "evt_s2_invoice", "sub_2");
    expect(await events(t)).toEqual([
      ["evt_s1", "applied"],
      ["evt_s2", "stray"],
      ["evt_s2_invoice", "stray"],
    ]);
    expect(await sessions(t)).toEqual([
      ["cs_fake_1", "complete"],
      ["cs_fake_2", "complete"],
    ]);
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.providerSubscriptionId).toBe("sub_1");
    const strays = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("paymentEvents")
          .withIndex("by_outcome", (q) => q.eq("outcome", "stray"))
          .collect()
      ).map((event) => [event.eventId, event.accountId, event.stray])
    );
    expect(strays).toEqual([
      [
        "evt_s2",
        accountId,
        { subscriptionRef: "sub_2", customerRef: "cus_1", amountCents: FAKE_CHECKOUT_AMOUNT_CENTS },
      ],
      ["evt_s2_invoice", accountId, { subscriptionRef: "sub_2", customerRef: "cus_1", amountCents: null }],
    ]);
  });

  test("a late event about an ended subscription doesn't suspend an org that subscribed again", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    const old = providerSubscription(accountId, { subscriptionRef: "sub_old" });
    provider.subscriptions.set("sub_old", old);
    await subscribe(t, provider, accountId, { eventId: "evt_1", subscriptionRef: "sub_old" });
    provider.subscriptions.set("sub_old", {
      ...old,
      standing: "ended",
      endedReason: "subscription_canceled",
      providerStatus: "canceled",
      observedAt: T0 + 2 * DAY,
    });
    await deliverAbout(t, provider, "evt_2", "sub_old");
    provider.subscriptions.set(
      "sub_new",
      providerSubscription(accountId, { subscriptionRef: "sub_new", observedAt: T0 + 3 * DAY })
    );
    await subscribe(t, provider, accountId, {
      eventId: "evt_3",
      subscriptionRef: "sub_new",
      nowMs: T0 + CHECKOUT_ATTEMPT.windowMs,
    });
    // Stripe redelivers an event about the old subscription; the read is fresh, and still ended.
    provider.subscriptions.set("sub_old", {
      ...old,
      standing: "ended",
      endedReason: "subscription_canceled",
      observedAt: T0 + 4 * DAY,
    });
    await deliverAbout(t, provider, "evt_4", "sub_old");
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toMatchObject({
      state: "active",
      providerSubscriptionId: "sub_new",
      providerStanding: "good",
    });
    expect(await events(t)).toEqual([
      ["evt_1", "applied"],
      ["evt_2", "applied"],
      ["evt_3", "applied"],
      ["evt_4", "ignored"],
    ]);
  });

  test("an older provider read arriving later is ignored as stale", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId, { observedAt: T0 + 2 * DAY }));
    await subscribe(t, provider, accountId, { eventId: "evt_new" });
    provider.subscriptions.set(
      "sub_1",
      providerSubscription(accountId, { standing: "payment_failed", providerStatus: "past_due", observedAt: T0 + DAY })
    );
    await deliver(t, provider, "evt_old");
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.state).toBe("active");
    expect(await events(t)).toEqual([
      ["evt_new", "applied"],
      ["evt_old", "ignored"],
    ]);
  });

  test("a payment after spin-down reactivates and schedules the engines' resume", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await t.run(async (ctx) => {
      const apply = async (event: Parameters<typeof applyTransition>[1]["event"], now: number) => {
        const result = await applyTransition(ctx, { accountId, event, now, actor: "test", origin: "signup" });
        if (!result.ok) {
          throw new Error(`fixture ${event.kind} illegal`);
        }
      };
      await apply({ kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays }, T0 - 60 * DAY);
      await apply({ kind: "EvaluationDue" }, T0 - 30 * DAY);
      await apply({ kind: "GraceExpired" }, T0 - 16 * DAY);
      await apply({ kind: "SpinDownDue" }, T0 - 9 * DAY);
    });
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await subscribe(t, provider, accountId, { eventId: "evt_pay" });
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.state).toBe("active");
    const resumes = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) =>
          job.name === "billing:runEngineEffect" && (job.args[0] as { effect: string }).effect === "resumeEngines"
      )
    );
    expect(resumes.length).toBe(1);
  });

  test("an unknown price is recorded as failed and answers 500 so the provider retries", async () => {
    const t = newBackend();
    await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.outage = err("unknown_price", "price_x is not a woofx3 price");
    const response = await deliver(t, provider, "evt_bad");
    expect(response.status).toBe(500);
    expect(await events(t)).toEqual([["evt_bad", "failed"]]);
  });

  test("a bad signature is refused before anything is recorded", async () => {
    const t = newBackend();
    const provider = new FakePaymentProvider();
    const response = await handlePaymentWebhook(
      { provider, runQuery: t.query, runMutation: t.mutation, now: () => T0 },
      "{}",
      new Headers()
    );
    expect(response.status).toBe(400);
    expect(await events(t)).toEqual([]);
  });
});

describe("billing actions", () => {
  test("an org admin may not start a checkout or open the portal", async () => {
    const t = newBackend();
    const { accountId, adminId } = await seedOrg(t);
    const asAdmin = t.withIdentity({ subject: `${adminId}|s` });
    await expect(
      asAdmin.action(api.billing.startCheckout, { accountId, plan: "starter", interval: "month" })
    ).rejects.toThrow("Your organization role doesn't allow this");
    await expect(asAdmin.action(api.billing.openPortal, { accountId })).rejects.toThrow(
      "Your organization role doesn't allow this"
    );
  });

  test("an org already paying is sent to the portal instead of a second checkout", async () => {
    const t = newBackend();
    const { accountId, ownerId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await subscribe(t, provider, accountId);
    await expect(
      t.withIdentity({ subject: `${ownerId}|s` }).action(api.billing.startCheckout, {
        accountId,
        plan: "pro",
        interval: "year",
      })
    ).rejects.toThrow("already has a subscription");
  });
});

describe("internal mutations", () => {
  test("applyProviderSubscription ignores an org that doesn't exist, or a ref that is no org id", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    for (const ref of [accountId, "not-an-org"]) {
      const subscription = { ...providerSubscription(accountId), accountId: ref as Id<"accounts"> };
      expect(await t.mutation(internal.billing.applyProviderSubscription, { subscription })).toMatchObject({
        outcome: "ignored",
      });
    }
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toEqual([]);
  });
});

describe("one checkout per org at a time", () => {
  const WINDOW = CHECKOUT_ATTEMPT.windowMs;

  test("requests in one window share a key and an expiry 35-65 minutes out; the next window gets a new key", () => {
    const accountId = "acct_1" as Id<"accounts">;
    const start = Math.ceil(T0 / WINDOW) * WINDOW;
    const first = checkoutAttempt(accountId, start);
    const late = checkoutAttempt(accountId, start + WINDOW - 1);
    expect(late).toEqual(first);
    expect(first.expiresAt - start).toBe(65 * 60_000);
    expect(first.expiresAt - (start + WINDOW - 1)).toBeGreaterThan(35 * 60_000 - 1);
    expect(checkoutAttempt(accountId, start + WINDOW).idempotencyKey).not.toBe(first.idempotencyKey);
    expect(checkoutAttempt("acct_2" as Id<"accounts">, start).idempotencyKey).not.toBe(first.idempotencyKey);
  });

  test("two concurrent requests get one session, recorded once, so at most one subscription", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    const [a, b] = await Promise.all([
      openCheckout(t, provider, accountId, T0),
      openCheckout(t, provider, accountId, T0 + 1000),
    ]);
    expect(a).toEqual(b);
    expect(provider.checkouts.size).toBe(1);
    expect(await sessions(t)).toEqual([["cs_fake_1", "open"]]);
  });

  test("another plan while a checkout is open is refused, not a second session", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    await openCheckout(t, provider, accountId, T0);
    await expect(
      openSubscriptionCheckout(
        { provider, runMutation: t.mutation, portalUrl: PORTAL },
        null,
        { accountId, plan: "starter", interval: "month" },
        T0 + 1000
      )
    ).rejects.toThrow("already open");
    expect(provider.checkouts.size).toBe(1);
  });

  test("a checkout in a new window expires the org's older open session at the provider", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    await openCheckout(t, provider, accountId, T0);
    await openCheckout(t, provider, accountId, T0 + WINDOW);
    expect(provider.sessionStates.get("cs_fake_1")).toBe("expired");
    expect(await sessions(t)).toEqual([
      ["cs_fake_1", "expired"],
      ["cs_fake_2", "open"],
    ]);
  });

  test("an older session the provider can't expire right now refuses the new checkout's URL", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    await openCheckout(t, provider, accountId, T0);
    const expireCheckout = provider.expireCheckout.bind(provider);
    provider.expireCheckout = async () => err("provider_unavailable", "Stripe is down");
    await expect(openCheckout(t, provider, accountId, T0 + WINDOW)).rejects.toThrow("Stripe is down");
    provider.expireCheckout = expireCheckout;
    await openCheckout(t, provider, accountId, T0 + WINDOW);
    expect(await sessions(t)).toEqual([
      ["cs_fake_1", "expired"],
      ["cs_fake_2", "open"],
    ]);
  });
});

describe("renewal check", () => {
  const PERIOD_END = T0 + 60 * DAY;
  const LATER = PERIOD_END + DAY;

  /** An active org whose period end passed with no renewal webhook, after the evaluator has run. */
  async function overdueOrg() {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId, { currentPeriodEnd: PERIOD_END }));
    await subscribe(t, provider, accountId);
    await t.mutation(internal.billing.evaluateOrg, { accountId, now: LATER });
    const deps = { provider, runQuery: t.query, runMutation: t.mutation, now: () => LATER };
    return { t, accountId, provider, deps };
  }

  test("the evaluator asks the provider once and leaves the org active meanwhile", async () => {
    const { t, accountId } = await overdueOrg();
    const row = await t.run((ctx) => subscriptionFor(ctx, accountId));
    expect(row?.state).toBe("active");
    expect(row?.nextBillingAt).toBeUndefined();
    expect(row?.nextCheckAt).toBeUndefined();
    const checks = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name === "billing:confirmRenewal"
      )
    );
    expect(checks.map((job) => job.args[0])).toEqual([{ accountId, attempt: 0 }]);
  });

  test("renewed at the provider: applied, and the org stays active until the new period end", async () => {
    const { t, accountId, provider, deps } = await overdueOrg();
    provider.subscriptions.set(
      "sub_1",
      providerSubscription(accountId, { currentPeriodEnd: PERIOD_END + 30 * DAY, observedAt: LATER })
    );
    expect(await checkRenewal(deps, accountId)).toBe("settled");
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toMatchObject({
      state: "active",
      nextBillingAt: PERIOD_END + 30 * DAY,
    });
  });

  test("ended at the provider: the org takes the ended path", async () => {
    const { t, accountId, provider, deps } = await overdueOrg();
    provider.subscriptions.set(
      "sub_1",
      providerSubscription(accountId, {
        standing: "ended",
        endedReason: "provider_ended",
        providerStatus: "unpaid",
        currentPeriodEnd: PERIOD_END,
        observedAt: LATER,
      })
    );
    expect(await checkRenewal(deps, accountId)).toBe("settled");
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toMatchObject({
      state: "suspended",
      stateReason: "provider_ended",
    });
  });

  test("provider unreachable: nothing changes and the check is retried", async () => {
    const { t, accountId, provider, deps } = await overdueOrg();
    const before = await t.run((ctx) => subscriptionFor(ctx, accountId));
    provider.outage = err("provider_unavailable", "Stripe is down");
    expect(await checkRenewal(deps, accountId)).toBe("retry");
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toEqual(before);
  });

  test("still active at the provider but not yet renewed: retried, not applied", async () => {
    const { t, accountId, provider, deps } = await overdueOrg();
    provider.subscriptions.set(
      "sub_1",
      providerSubscription(accountId, { currentPeriodEnd: PERIOD_END, observedAt: LATER })
    );
    expect(await checkRenewal(deps, accountId)).toBe("retry");
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.nextBillingAt).toBeUndefined();
  });

  test("retries back off and stay at the cap", () => {
    expect(renewalRetryDelay(0, 1)).toBe(RENEWAL_CHECK_RETRY.baseDelayMs);
    expect(renewalRetryDelay(1, 1)).toBe(RENEWAL_CHECK_RETRY.baseDelayMs * 2);
    expect(renewalRetryDelay(40, 1)).toBe(RENEWAL_CHECK_RETRY.maxDelayMs);
    expect(renewalRetryDelay(40, 0)).toBe(RENEWAL_CHECK_RETRY.maxDelayMs / 2);
  });
});
