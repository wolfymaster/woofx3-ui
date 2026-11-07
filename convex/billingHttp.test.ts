import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CHECKOUT_ATTEMPT, checkoutAttempt, openSubscriptionCheckout } from "./billing";
import { handleBillingWebhook } from "./billingHttp";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { newBackend } from "./lib/convexTest.testing";
import { FakePaymentProvider } from "./lib/payments/fake";
import { err, type ProviderSubscription } from "./lib/payments/provider";
import { applyTransition, subscriptionFor } from "./lib/subscriptions";

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
  return handleBillingWebhook({ provider, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
}

function deliverAbout(t: Backend, provider: FakePaymentProvider, eventId: string, subscriptionRef: string) {
  const body = JSON.stringify({
    eventId,
    type: "customer.subscription.updated",
    purpose: "subscription",
    subscriptionRef,
  });
  return handleBillingWebhook({ provider, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
}

async function events(t: Backend) {
  return t.run(async (ctx) => (await ctx.db.query("billingEvents").collect()).map((e) => [e.eventId, e.outcome]));
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

describe("billing webhook", () => {
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
    const response = await handleBillingWebhook({ provider, runMutation: t.mutation, now: () => T0 }, body, SIGNED);
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

  test("a checkout with no subscription row activates the org and mirrors the provider", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    expect((await deliver(t, provider, "evt_1")).status).toBe(200);
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
  });

  test("a duplicate delivery applies once", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await deliver(t, provider, "evt_1");
    const again = await deliver(t, provider, "evt_1");
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(await transitions(t, accountId)).toEqual(["ProviderActivated"]);
    expect(provider.calls.filter((c) => c.method === "fetchSubscription").length).toBe(1);
  });

  test("a late event about an ended subscription doesn't suspend an org that subscribed again", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakePaymentProvider();
    const old = providerSubscription(accountId, { subscriptionRef: "sub_old" });
    provider.subscriptions.set("sub_old", old);
    await deliverAbout(t, provider, "evt_1", "sub_old");
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
    await deliverAbout(t, provider, "evt_3", "sub_new");
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
    await deliver(t, provider, "evt_new");
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
    await deliver(t, provider, "evt_pay");
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
    const response = await handleBillingWebhook(
      { provider, runMutation: t.mutation, now: () => T0 },
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
    await deliver(t, provider, "evt_1");
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

  test("two concurrent requests get one session, so at most one subscription", async () => {
    const provider = new FakePaymentProvider();
    const args = { accountId: "acct_1" as Id<"accounts">, plan: "pro" as const, interval: "month" as const };
    const [a, b] = await Promise.all([
      openSubscriptionCheckout(provider, "https://woofx3.tv/org", null, args, T0),
      openSubscriptionCheckout(provider, "https://woofx3.tv/org", null, args, T0 + 1000),
    ]);
    expect(a).toEqual(b);
    expect(provider.checkouts.size).toBe(1);
  });

  test("another plan while a checkout is open is refused, not a second session", async () => {
    const provider = new FakePaymentProvider();
    const args = { accountId: "acct_1" as Id<"accounts">, plan: "pro" as const, interval: "month" as const };
    await openSubscriptionCheckout(provider, "https://woofx3.tv/org", null, args, T0);
    await expect(
      openSubscriptionCheckout(provider, "https://woofx3.tv/org", null, { ...args, plan: "starter" }, T0 + 1000)
    ).rejects.toThrow("already open");
    expect(provider.checkouts.size).toBe(1);
  });
});
