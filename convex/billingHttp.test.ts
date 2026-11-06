import { describe, expect, test } from "bun:test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { handleBillingWebhook } from "./billingHttp";
import { FakeBillingProvider } from "./lib/billing/fake";
import { err, type ProviderSubscription } from "./lib/billing/provider";
import { BILLING_LIFECYCLE } from "./lib/billingLifecycle";
import { newBackend } from "./lib/convexTest.testing";
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

function deliver(t: Backend, provider: FakeBillingProvider, eventId: string) {
  const body = JSON.stringify({
    kind: "subscription.changed",
    eventId,
    type: "invoice.paid",
    subscriptionRef: "sub_1",
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
  test("a checkout with no subscription row activates the org and mirrors the provider", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakeBillingProvider();
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
    const provider = new FakeBillingProvider();
    provider.subscriptions.set("sub_1", providerSubscription(accountId));
    await deliver(t, provider, "evt_1");
    const again = await deliver(t, provider, "evt_1");
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(await transitions(t, accountId)).toEqual(["ProviderActivated"]);
    expect(provider.calls.filter((c) => c.method === "fetchSubscription").length).toBe(1);
  });

  test("an older provider read arriving later is ignored as stale", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    const provider = new FakeBillingProvider();
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
    const provider = new FakeBillingProvider();
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
    const provider = new FakeBillingProvider();
    provider.outage = err("unknown_price", "price_x is not a woofx3 price");
    const response = await deliver(t, provider, "evt_bad");
    expect(response.status).toBe(500);
    expect(await events(t)).toEqual([["evt_bad", "failed"]]);
  });

  test("a bad signature is refused before anything is recorded", async () => {
    const t = newBackend();
    const provider = new FakeBillingProvider();
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
    const provider = new FakeBillingProvider();
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
  test("applyProviderSubscription refuses an org that doesn't exist", async () => {
    const t = newBackend();
    const { accountId } = await seedOrg(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    await expect(
      t.mutation(internal.billing.applyProviderSubscription, { subscription: providerSubscription(accountId) })
    ).rejects.toThrow("names missing org");
  });
});
