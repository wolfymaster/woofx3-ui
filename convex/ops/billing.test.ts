import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { BILLING_LIFECYCLE } from "../lib/billingLifecycle";
import { newBackend } from "../lib/convexTest.testing";
import type { DiscountSpec } from "../lib/payments/provider";
import { applyTransition, subscriptionFor } from "../lib/subscriptions";
import { discountAttemptKey } from "./billing";

type Backend = ReturnType<typeof newBackend>;

const OPERATOR = { actor: "ops@woofx3.tv", reason: "support ticket 12" };

async function org(t: Backend, opts: { trial?: boolean; provider?: boolean } = {}) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
    if (opts.trial) {
      const result = await applyTransition(ctx, {
        accountId,
        event: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
        now: Date.now(),
        actor: "test",
        origin: "signup",
      });
      if (!result.ok) {
        throw new Error("fixture");
      }
      if (opts.provider) {
        await ctx.db.patch(result.subscription._id, {
          provider: "stripe",
          providerCustomerId: "cus_1",
          providerSubscriptionId: "sub_1",
        });
      }
    }
    return accountId;
  });
}

async function audit(t: Backend) {
  return t.run(async (ctx) => (await ctx.db.query("opsAuditLog").collect()).map((row) => [row.action, row.result]));
}

describe("ops billing writes", () => {
  test("an exemption is granted, changed and revoked through the lifecycle", async () => {
    const t = newBackend();
    const accountId = await org(t, { trial: true });
    const until = Date.now() + 90 * 24 * 60 * 60 * 1000;
    const granted = await t.mutation(internal.ops.billing.setExemption, {
      accountId,
      ...OPERATOR,
      exemption: { kind: "grant", plan: "pro", until: null },
    });
    expect(granted).toMatchObject({ ok: true, result: { state: "exempt", plan: "pro", exemptUntil: null } });
    const changed = await t.mutation(internal.ops.billing.setExemption, {
      accountId,
      ...OPERATOR,
      exemption: { kind: "grant", plan: "starter", until },
    });
    expect(changed).toMatchObject({ ok: true, result: { state: "exempt", plan: "starter", exemptUntil: until } });
    const revoked = await t.mutation(internal.ops.billing.setExemption, {
      accountId,
      ...OPERATOR,
      exemption: { kind: "revoke" },
    });
    expect(revoked).toMatchObject({ ok: true, result: { state: "past_due", stateReason: "no_payment_method" } });
    expect(await audit(t)).toEqual([
      ["accounts.setExemption", "ok"],
      ["accounts.setExemption", "ok"],
      ["accounts.setExemption", "ok"],
    ]);
  });

  test("a plan change is refused for a provider-billed org, and audited", async () => {
    const t = newBackend();
    const accountId = await org(t, { trial: true, provider: true });
    const result = await t.mutation(internal.ops.billing.setPlan, { accountId, ...OPERATOR, plan: "pro" });
    expect(result).toMatchObject({ ok: false, status: 409, code: "provider_managed" });
    expect(await audit(t)).toEqual([["accounts.setPlan", "provider_managed"]]);
  });

  test("a trial stays Starter; an exempt org can change tier", async () => {
    const t = newBackend();
    const accountId = await org(t, { trial: true });
    expect(await t.mutation(internal.ops.billing.setPlan, { accountId, ...OPERATOR, plan: "pro" })).toMatchObject({
      ok: false,
      code: "trial_is_starter",
    });
    await t.mutation(internal.ops.billing.setExemption, {
      accountId,
      ...OPERATOR,
      exemption: { kind: "grant", plan: "starter", until: null },
    });
    expect(await t.mutation(internal.ops.billing.setPlan, { accountId, ...OPERATOR, plan: "pro" })).toMatchObject({
      ok: true,
      result: { state: "exempt", plan: "pro", updatedBy: OPERATOR.actor },
    });
  });

  test("a suspension starts the spin-down grace and keeps the operator's reason", async () => {
    const t = newBackend();
    const accountId = await org(t, { trial: true });
    const result = await t.mutation(internal.ops.billing.suspend, {
      accountId,
      ...OPERATOR,
      suspendReason: "chargeback",
    });
    expect(result).toMatchObject({ ok: true, result: { state: "suspended", stateReason: "operator" } });
    const row = await t.run(async (ctx) => (await ctx.db.query("opsAuditLog").collect())[0]);
    expect(row?.request).toBe(JSON.stringify({ reason: "chargeback" }));
    const again = await t.mutation(internal.ops.billing.suspend, { accountId, ...OPERATOR, suspendReason: "again" });
    expect(again).toMatchObject({ ok: false, status: 409, code: "illegal_transition" });
  });

  test("a discount needs a provider subscription", async () => {
    const t = newBackend();
    const accountId = await org(t, { trial: true });
    const result = await t.action(internal.ops.billing.applyDiscount, {
      accountId,
      ...OPERATOR,
      key: "spring",
      spec: { kind: "percent_off", percent: 50, duration: { kind: "months", months: 3 } },
    });
    expect(result).toMatchObject({ ok: false, status: 409, code: "no_subscription" });
    expect(await audit(t)).toEqual([["accounts.applyDiscount", "no_subscription"]]);
  });

  test("an unknown account is a 404, audited", async () => {
    const t = newBackend();
    const accountId = await org(t);
    await t.run((ctx) => ctx.db.delete(accountId));
    const result = await t.mutation(internal.ops.billing.suspend, { accountId, ...OPERATOR, suspendReason: "x" });
    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(await audit(t)).toEqual([["accounts.suspend", "not_found"]]);
  });
});

describe("getAccount", () => {
  test("includes the subscription and its latest transitions first", async () => {
    const t = newBackend();
    const accountId: Id<"accounts"> = await org(t, { trial: true });
    await t.mutation(internal.ops.billing.suspend, { accountId, ...OPERATOR, suspendReason: "x" });
    const detail = await t.query(internal.ops.reads.getAccount, { accountId, now: Date.now() });
    expect(detail?.subscription).toMatchObject({ state: "suspended", plan: "starter" });
    expect(detail?.transitions.map((row) => row.event)).toEqual(["OperatorSuspended", "TrialStarted"]);
    expect((await t.run((ctx) => subscriptionFor(ctx, accountId)))?.updatedBy).toBe(OPERATOR.actor);
  });
});

describe("discountAttemptKey", () => {
  const accountId = "acct_1";
  const spec: DiscountSpec = { kind: "percent_off", percent: 20, duration: { kind: "months", months: 3 } };
  const first = discountAttemptKey(accountId, "sub_1", "spring", spec);

  test("a retry of the same request reuses its key", () => {
    expect(discountAttemptKey(accountId, "sub_1", "spring", { ...spec })).toBe(first);
  });

  const changed: Array<[string, string]> = [
    ["another subscription", discountAttemptKey(accountId, "sub_2", "spring", spec)],
    ["another percent", discountAttemptKey(accountId, "sub_1", "spring", { ...spec, percent: 50 })],
    ["another duration", discountAttemptKey(accountId, "sub_1", "spring", { ...spec, duration: { kind: "once" } })],
    [
      "an amount off",
      discountAttemptKey(accountId, "sub_1", "spring", {
        kind: "amount_off",
        amountCents: 20,
        currency: "usd",
        duration: spec.duration,
      }),
    ],
    ["another discount key", discountAttemptKey(accountId, "sub_1", "summer", spec)],
  ];
  for (const [name, key] of changed) {
    test(`${name} gets its own key`, () => {
      expect(key).not.toBe(first);
    });
  }
});
