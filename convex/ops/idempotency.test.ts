import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { BILLING_LIFECYCLE } from "../lib/billingLifecycle";
import { newBackend } from "../lib/convexTest.testing";
import { OPS_SECRET_ENV } from "../lib/ops/auth";
import { OPS_REQUESTS } from "../lib/ops/idempotency";
import type { DiscountSpec } from "../lib/payments/provider";
import { applyTransition, subscriptionFor } from "../lib/subscriptions";

type Backend = ReturnType<typeof newBackend>;

const OPERATOR = { actor: "ops@woofx3.tv", reason: "support ticket 12" };
const SPEC: DiscountSpec = { kind: "percent_off", percent: 50, duration: { kind: "months", months: 3 } };

async function trialOrg(t: Backend, opts: { provider?: boolean } = {}): Promise<Id<"accounts">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Org", ownerId, createdAt: 1 });
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
    return accountId;
  });
}

async function auditResults(t: Backend) {
  return t.run(async (ctx) => (await ctx.db.query("opsAuditLog").collect()).map((row) => row.result));
}

async function requests(t: Backend) {
  return t.run(async (ctx) => ctx.db.query("opsRequests").collect());
}

describe("billing writes run once per idempotency key", () => {
  test("a repeat replays the first success and writes nothing", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const args = { accountId, ...OPERATOR, idempotencyKey: "key-suspend-1", suspendReason: "chargeback" };
    const first = await t.mutation(internal.ops.billing.suspend, args);
    const again = await t.mutation(internal.ops.billing.suspend, args);
    expect(first).toMatchObject({ ok: true, result: { state: "suspended" } });
    expect(again).toEqual(first);
    expect(await auditResults(t)).toEqual(["ok"]);
    expect((await requests(t)).map((row) => row.state)).toEqual(["done"]);
  });

  test("the same key with another body is refused and changes nothing", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const grant = (plan: "starter" | "pro") =>
      t.mutation(internal.ops.billing.setExemption, {
        accountId,
        ...OPERATOR,
        idempotencyKey: "key-exempt-1",
        exemption: { kind: "grant", plan, until: null },
      });
    expect(await grant("starter")).toMatchObject({ ok: true, result: { plan: "starter" } });
    expect(await grant("pro")).toMatchObject({ ok: false, status: 409, code: "idempotency_mismatch" });
    expect(await t.run((ctx) => subscriptionFor(ctx, accountId))).toMatchObject({ state: "exempt", plan: "starter" });
  });

  test("a refusal releases the key, so the same request succeeds once it is allowed", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const setPro = { accountId, ...OPERATOR, idempotencyKey: "key-plan-1", plan: "pro" as const };
    expect(await t.mutation(internal.ops.billing.setPlan, setPro)).toMatchObject({ code: "trial_is_starter" });
    expect(await requests(t)).toEqual([]);
    await t.mutation(internal.ops.billing.setExemption, {
      accountId,
      ...OPERATOR,
      idempotencyKey: "key-exempt-2",
      exemption: { kind: "grant", plan: "starter", until: null },
    });
    expect(await t.mutation(internal.ops.billing.setPlan, setPro)).toMatchObject({ ok: true, result: { plan: "pro" } });
  });

  test("keys are per route and per organization", async () => {
    const t = newBackend();
    const first = await trialOrg(t);
    const second = await trialOrg(t);
    const suspend = (accountId: Id<"accounts">) =>
      t.mutation(internal.ops.billing.suspend, {
        accountId,
        ...OPERATOR,
        idempotencyKey: "key-shared",
        suspendReason: "x",
      });
    expect(await suspend(first)).toMatchObject({ ok: true });
    expect(await suspend(second)).toMatchObject({ ok: true });
    expect(await auditResults(t)).toEqual(["ok", "ok"]);
  });
});

describe("discount idempotency", () => {
  const discount = (accountId: Id<"accounts">) => ({
    accountId,
    ...OPERATOR,
    idempotencyKey: "key-discount-1",
    key: "spring",
    spec: SPEC,
  });

  test("a call while the first is pending answers in_progress, and a stale claim is taken over", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const { actor: _actor, reason: _reason, ...claimArgs } = discount(accountId);
    expect(await t.mutation(internal.ops.billing.claimDiscount, claimArgs)).toEqual({ kind: "claimed" });
    expect(await t.action(internal.ops.billing.applyDiscount, discount(accountId))).toMatchObject({
      ok: false,
      status: 409,
      code: "in_progress",
    });
    const [pending] = await requests(t);
    await t.run((ctx) => ctx.db.patch(pending._id, { claimedAt: Date.now() - OPS_REQUESTS.staleClaimMs - 1 }));
    // Taken over, it runs: this org has no provider subscription, and the refusal releases the key.
    expect(await t.action(internal.ops.billing.applyDiscount, discount(accountId))).toMatchObject({
      code: "no_subscription",
    });
    expect(await requests(t)).toEqual([]);
  });

  test("an applied discount is replayed without calling the provider again", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t, { provider: true });
    const { actor: _actor, reason: _reason, ...claimArgs } = discount(accountId);
    await t.mutation(internal.ops.billing.claimDiscount, claimArgs);
    const applied = await t.mutation(internal.ops.billing.recordDiscount, {
      ...discount(accountId),
      outcome: { kind: "applied", discount: { spec: SPEC, code: null, endsAt: null } },
    });
    expect(applied).toMatchObject({ ok: true });
    // No payments configuration is set, so reaching the provider would throw.
    expect(await t.action(internal.ops.billing.applyDiscount, discount(accountId))).toEqual(applied);
  });
});

describe("POST /api/ops/accounts/:id/suspend", () => {
  const SECRET = "s".repeat(64);
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env[OPS_SECRET_ENV];
    process.env[OPS_SECRET_ENV] = SECRET;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env[OPS_SECRET_ENV];
    } else {
      process.env[OPS_SECRET_ENV] = previous;
    }
  });

  function post(t: Backend, accountId: string, body: unknown, idempotencyKey?: string) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${SECRET}`,
      "X-Woofx3-Actor": OPERATOR.actor,
      "X-Woofx3-Reason": encodeURIComponent(OPERATOR.reason),
      "Content-Type": "application/json",
    };
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return t.fetch(`/api/ops/accounts/${accountId}/suspend`, { method: "POST", headers, body: JSON.stringify(body) });
  }

  test.each([
    ["missing", undefined],
    ["too short", "short"],
    ["too long", "k".repeat(101)],
    ["with a space", "key with space"],
  ])("a %s Idempotency-Key is a 400 and changes nothing", async (_name, key) => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const response = await post(t, accountId, { reason: "chargeback" }, key);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_idempotency_key" } });
    expect(await auditResults(t)).toEqual([]);
  });

  test("an invalid body is a 400 and does not use up the key", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const key = crypto.randomUUID();
    expect((await post(t, accountId, { reason: "" }, key)).status).toBe(400);
    expect(await requests(t)).toEqual([]);
    expect((await post(t, accountId, { reason: "chargeback" }, key)).status).toBe(200);
  });

  test("a retry gets the first answer's status and body", async () => {
    const t = newBackend();
    const accountId = await trialOrg(t);
    const key = crypto.randomUUID();
    const first = await post(t, accountId, { reason: "chargeback" }, key);
    const again = await post(t, accountId, { reason: "chargeback" }, key);
    expect(again.status).toBe(first.status);
    expect(await again.text()).toBe(await first.text());
    const other = await post(t, accountId, { reason: "fraud" }, key);
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: { code: "idempotency_mismatch" } });
  });
});
