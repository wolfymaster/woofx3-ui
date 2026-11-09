import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import type { LifecycleEvent } from "../lib/billingLifecycle";
import { recordOpsAudit } from "../lib/ops/audit";
import { type SubscriptionDto, subscriptionDto } from "../lib/ops/dto";
import { planTierValidator } from "../lib/organization";
import { paymentsConfig } from "../lib/payments/config";
import { appliedDiscountValidator, type DiscountSpec, discountSpecValidator } from "../lib/payments/provider";
import { paymentProvider } from "../lib/payments/registry";
import { applyTransition, setSubscriptionPlan, subscriptionFor } from "../lib/subscriptions";

// Operator writes to an org's subscription, from the backoffice through the
// ops API. Each one is audited with the operator and their reason, whatever
// its outcome. A provider-billed subscription changes plan in the provider,
// never here.

export type BillingWriteResult =
  | { ok: true; result: SubscriptionDto }
  | { ok: false; status: 400 | 404 | 409 | 502; code: string; message: string };

interface OperatorWrite {
  accountId: string;
  actor: string;
  reason: string;
}

const operatorArgs = { accountId: v.string(), actor: v.string(), reason: v.string() };

type Refusal = Extract<BillingWriteResult, { ok: false }>;

/** Runs an audited write against the org's subscription row, which must exist. */
async function audited(
  ctx: MutationCtx,
  write: OperatorWrite,
  action: string,
  request: Record<string, unknown>,
  apply: (accountId: Id<"accounts">, row: Doc<"subscriptions"> | null) => Promise<BillingWriteResult>
): Promise<BillingWriteResult> {
  const accountId = ctx.db.normalizeId("accounts", write.accountId);
  const account = accountId === null ? null : await ctx.db.get(accountId);
  const outcome: BillingWriteResult =
    accountId === null || account === null
      ? { ok: false, status: 404, code: "not_found", message: "No such account" }
      : await apply(accountId, await subscriptionFor(ctx, accountId));
  await recordOpsAudit(ctx, {
    actor: write.actor,
    action,
    target: write.accountId,
    reason: write.reason,
    request,
    result: outcome.ok ? "ok" : outcome.code,
  });
  return outcome;
}

const NO_SUBSCRIPTION: Refusal = {
  ok: false,
  status: 409,
  code: "no_subscription",
  message: "This organization has no subscription",
};

async function transitionOrRefuse(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  event: LifecycleEvent,
  actor: string
): Promise<BillingWriteResult> {
  const result = await applyTransition(ctx, { accountId, event, now: Date.now(), actor, origin: "operator" });
  if (!result.ok) {
    return {
      ok: false,
      status: 409,
      code: "illegal_transition",
      message: `${result.error.event} doesn't apply to a ${result.error.from} subscription`,
    };
  }
  return { ok: true, result: subscriptionDto(result.subscription) };
}

/** Sets the plan of an org no provider bills. A trial is always Starter. */
export const setPlan = internalMutation({
  args: { ...operatorArgs, plan: planTierValidator },
  handler: async (ctx, args): Promise<BillingWriteResult> =>
    audited(ctx, args, "accounts.setPlan", { plan: args.plan }, async (_accountId, row) => {
      if (row === null) {
        return NO_SUBSCRIPTION;
      }
      if (row.providerSubscriptionId !== undefined) {
        return {
          ok: false,
          status: 409,
          code: "provider_managed",
          message: "This organization pays through its provider; change its plan in the customer portal or Stripe",
        };
      }
      if (row.state === "trialing" && args.plan !== "starter") {
        return {
          ok: false,
          status: 409,
          code: "trial_is_starter",
          message: "A trial is Starter; grant an exemption to give this organization Pro",
        };
      }
      return {
        ok: true,
        result: subscriptionDto(await setSubscriptionPlan(ctx, row, args.plan, Date.now(), args.actor)),
      };
    }),
});

/** Grants or changes an exemption (free access on a plan, optionally until a time), or revokes it. */
export const setExemption = internalMutation({
  args: {
    ...operatorArgs,
    exemption: v.union(
      v.object({ kind: v.literal("grant"), plan: planTierValidator, until: v.union(v.number(), v.null()) }),
      v.object({ kind: v.literal("revoke") })
    ),
  },
  handler: async (ctx, args): Promise<BillingWriteResult> =>
    audited(ctx, args, "accounts.setExemption", { ...args.exemption }, async (accountId) => {
      const { exemption } = args;
      if (exemption.kind === "grant" && exemption.until !== null && exemption.until <= Date.now()) {
        return { ok: false, status: 400, code: "invalid_exemption", message: "until must be in the future" };
      }
      const event: LifecycleEvent =
        exemption.kind === "grant"
          ? { kind: "ExemptionGranted", plan: exemption.plan, until: exemption.until }
          : { kind: "ExemptionRevoked" };
      return transitionOrRefuse(ctx, accountId, event, args.actor);
    }),
});

/** Suspends the org now; its managed engines stop after the usual spin-down grace. */
export const suspend = internalMutation({
  args: { ...operatorArgs, suspendReason: v.string() },
  handler: async (ctx, args): Promise<BillingWriteResult> =>
    audited(ctx, args, "accounts.suspend", { reason: args.suspendReason }, async (accountId, row) =>
      row === null ? NO_SUBSCRIPTION : transitionOrRefuse(ctx, accountId, { kind: "OperatorSuspended" }, args.actor)
    ),
});

/** The provider subscription a discount attaches to, or why there is none. */
export const discountTarget = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; subscriptionRef: string } | Refusal> => {
    const accountId = ctx.db.normalizeId("accounts", args.accountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { ok: false, status: 404, code: "not_found", message: "No such account" };
    }
    const row = await subscriptionFor(ctx, accountId);
    return row?.providerSubscriptionId === undefined
      ? { ...NO_SUBSCRIPTION, message: "A discount needs a provider subscription to attach to" }
      : { ok: true, subscriptionRef: row.providerSubscriptionId };
  },
});

/** Mirrors an applied discount onto the subscription, and audits the write either way. */
export const recordDiscount = internalMutation({
  args: {
    ...operatorArgs,
    key: v.string(),
    spec: discountSpecValidator,
    outcome: v.union(
      v.object({ kind: v.literal("applied"), discount: appliedDiscountValidator }),
      v.object({
        kind: v.literal("refused"),
        status: v.union(v.literal(404), v.literal(409), v.literal(502)),
        code: v.string(),
        message: v.string(),
      })
    ),
  },
  handler: async (ctx, args): Promise<BillingWriteResult> =>
    audited(ctx, args, "accounts.applyDiscount", { key: args.key, spec: args.spec }, async (_accountId, row) => {
      const { outcome } = args;
      if (outcome.kind === "refused") {
        return { ok: false, status: outcome.status, code: outcome.code, message: outcome.message };
      }
      if (row === null) {
        throw new Error(`recordDiscount: ${args.accountId} applied a discount but has no subscription row`);
      }
      await ctx.db.patch(row._id, { discount: outcome.discount, updatedAt: Date.now(), updatedBy: args.actor });
      const updated = await ctx.db.get(row._id);
      if (updated === null) {
        throw new Error(`recordDiscount: ${row._id} vanished inside its own mutation`);
      }
      return { ok: true, result: subscriptionDto(updated) };
    }),
});

/**
 * The idempotency key of one discount request. A retry of the same request
 * asks the provider for the same change; another subscription or other terms
 * are another request, which the provider must not take for a replay.
 */
export function discountAttemptKey(
  accountId: string,
  subscriptionRef: string,
  key: string,
  spec: DiscountSpec
): string {
  const amount = spec.kind === "percent_off" ? `${spec.percent}pct` : `${spec.amountCents}${spec.currency}`;
  const duration = spec.duration.kind === "months" ? `${spec.duration.months}mo` : spec.duration.kind;
  return `ops-discount:${accountId}:${subscriptionRef}:${key}:${amount}:${duration}`;
}

/**
 * Attaches a discount to the org's provider subscription, creating the
 * provider's coupon for `key` first if it is missing.
 */
export const applyDiscount = internalAction({
  args: { ...operatorArgs, key: v.string(), spec: discountSpecValidator },
  handler: async (ctx, args): Promise<BillingWriteResult> => {
    const target = await ctx.runQuery(internal.ops.billing.discountTarget, { accountId: args.accountId });
    if (!target.ok) {
      const { status, code, message } = target;
      if (status !== 404 && status !== 409) {
        throw new Error(`applyDiscount: unexpected refusal status ${status}`);
      }
      return ctx.runMutation(internal.ops.billing.recordDiscount, {
        ...args,
        outcome: { kind: "refused", status, code, message },
      });
    }
    const result = await paymentProvider(paymentsConfig()).applyDiscount({
      subscriptionRef: target.subscriptionRef,
      key: args.key,
      spec: args.spec,
      idempotencyKey: discountAttemptKey(args.accountId, target.subscriptionRef, args.key, args.spec),
    });
    return ctx.runMutation(internal.ops.billing.recordDiscount, {
      ...args,
      outcome: result.ok
        ? { kind: "applied", discount: result.value }
        : { kind: "refused", status: 502, code: result.error.code, message: result.error.message },
    });
  },
});
