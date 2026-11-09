import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  assertLifecycle,
  type Lifecycle,
  type LifecycleEffect,
  type LifecycleEvent,
  type ProviderView,
  type TransitionResult,
  transition,
} from "./billingLifecycle";
import type { PlanTier } from "./organization";

// The one writer of `subscriptions`: loads an org's lifecycle, runs the state
// machine, and writes the row, its history and its scheduled effects in the
// caller's mutation, so they commit together. Convex scheduled functions are
// transactional, which makes them this change's outbox.

export type SubscriptionOrigin = Doc<"subscriptions">["origin"];

/** Effects the lifecycle issues again on a recheck; only the newest issue of one acts. */
const RECHECKED_EFFECTS: ReadonlySet<LifecycleEffect["kind"]> = new Set(["stopEngines", "confirmRenewal"]);

/** Whether `transitionId` issued the org's current rechecked effect, so its action should still act. */
export function isCurrentIssue(row: Doc<"subscriptions">, transitionId: Id<"subscriptionTransitions">): boolean {
  return row.effectIssuedBy === transitionId;
}

export async function subscriptionFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"subscriptions"> | null> {
  return ctx.db
    .query("subscriptions")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
}

export function lifecycleOf(row: Doc<"subscriptions">): Lifecycle {
  return {
    state: row.state,
    plan: row.plan,
    stateReason: row.stateReason,
    stateSince: row.stateSince,
    trialStartedAt: row.trialStartedAt,
    nextBillingAt: row.nextBillingAt,
    graceEndsAt: row.graceEndsAt,
    nextRetryAt: row.nextRetryAt,
    exemptUntil: row.exemptUntil,
    spinDownAt: row.spinDownAt,
    nextCheckAt: row.nextCheckAt,
  };
}

/** What the subscription last stored about its provider subscription, or null when it has none. */
export function providerViewOf(row: Doc<"subscriptions"> | null): ProviderView {
  if (row?.providerSubscriptionId === undefined || row.providerStanding === undefined) {
    return null;
  }
  if (row.providerPeriodEnd === undefined) {
    throw new Error(`subscription ${row._id} has a provider standing but no period end`);
  }
  return {
    standing: row.providerStanding,
    endedReason: row.providerEndedReason ?? null,
    currentPeriodEnd: row.providerPeriodEnd,
  };
}

export interface TransitionRequest {
  accountId: Id<"accounts">;
  event: LifecycleEvent;
  now: number;
  actor: string;
  /** Recorded when the transition creates the row. */
  origin: SubscriptionOrigin;
  /** The provider's view to evaluate against; the stored one when omitted. */
  provider?: ProviderView;
}

export type AppliedTransition =
  | { ok: true; transitionId: Id<"subscriptionTransitions">; subscription: Doc<"subscriptions"> }
  | Extract<TransitionResult, { ok: false }>;

/**
 * Applies a lifecycle event to the org. An illegal transition changes nothing
 * and is returned for the caller to record; it is never thrown, since a stale
 * webhook or a timer that lost a race lands there.
 */
export async function applyTransition(ctx: MutationCtx, request: TransitionRequest): Promise<AppliedTransition> {
  const row = await subscriptionFor(ctx, request.accountId);
  const current = row === null ? null : lifecycleOf(row);
  const provider = request.provider === undefined ? providerViewOf(row) : request.provider;
  const result = transition(current, request.event, { now: request.now, provider });
  if (!result.ok) {
    return result;
  }
  const { next, effects, note } = result;
  const written = { ...next, updatedAt: request.now, updatedBy: request.actor };
  let subscriptionId: Id<"subscriptions">;
  if (row === null) {
    subscriptionId = await ctx.db.insert("subscriptions", {
      accountId: request.accountId,
      ...written,
      addOns: [],
      origin: request.origin,
    });
  } else {
    subscriptionId = row._id;
    await ctx.db.patch(row._id, written);
  }
  if (current?.state === "suspended" && next.state !== "suspended") {
    await forgetStopRetries(ctx, request.accountId);
  }
  const transitionId = await ctx.db.insert("subscriptionTransitions", {
    accountId: request.accountId,
    from: current?.state,
    to: next.state,
    event: request.event.kind,
    reason: next.stateReason,
    actor: request.actor,
    at: request.now,
    note,
  });
  if (effects.some((effect) => RECHECKED_EFFECTS.has(effect.kind))) {
    await ctx.db.patch(subscriptionId, { effectIssuedBy: transitionId });
  }
  await scheduleEffects(ctx, request.accountId, transitionId, effects);
  const subscription = await ctx.db.get(subscriptionId);
  if (subscription === null) {
    throw new Error(`applyTransition: subscription ${subscriptionId} vanished inside its own mutation`);
  }
  return { ok: true, transitionId, subscription };
}

/** Provisioning rows read per org. An org holds a handful of engines, so this is a backstop, not a page size. */
export const ENGINES_PER_ORG_SCAN = 50;

/**
 * The failed-stop retries of the org's engines count against one suspension
 * (billing.ENGINE_STOP_RETRY), so leaving it clears them: an engine a later
 * suspension must stop gets its full set of retries.
 */
async function forgetStopRetries(ctx: MutationCtx, accountId: Id<"accounts">): Promise<void> {
  const rows = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(ENGINES_PER_ORG_SCAN);
  for (const row of rows) {
    if (row.stopRetries !== undefined) {
      await ctx.db.patch(row._id, { stopRetries: undefined });
    }
  }
}

async function scheduleEffects(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  transitionId: Id<"subscriptionTransitions">,
  effects: LifecycleEffect[]
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case "notifyOwner":
        await ctx.scheduler.runAt(effect.at, internal.billing.deliverWarning, {
          accountId,
          transitionId,
          template: effect.template,
          stint: effect.stint,
        });
        break;
      case "confirmRenewal":
        await ctx.scheduler.runAfter(0, internal.billing.confirmRenewal, { accountId, transitionId, attempt: 0 });
        break;
      case "stopEngines":
      case "resumeEngines":
        await ctx.scheduler.runAfter(0, internal.billing.runEngineEffect, {
          accountId,
          transitionId,
          effect: effect.kind,
        });
        break;
    }
  }
}

/**
 * Changes the plan of a subscription no provider bills: an operator moving an
 * exempt or unbilled org between tiers. Not a lifecycle event, so the state
 * and its timers stay; the write invariants are asserted as for any write.
 */
export async function setSubscriptionPlan(
  ctx: MutationCtx,
  row: Doc<"subscriptions">,
  plan: PlanTier,
  now: number,
  actor: string
): Promise<Doc<"subscriptions">> {
  if (row.providerSubscriptionId !== undefined) {
    throw new Error(`setSubscriptionPlan: ${row._id} is billed by its provider; its plan changes there`);
  }
  assertLifecycle({ ...lifecycleOf(row), plan });
  await ctx.db.patch(row._id, { plan, updatedAt: now, updatedBy: actor });
  const updated = await ctx.db.get(row._id);
  if (updated === null) {
    throw new Error(`setSubscriptionPlan: ${row._id} vanished inside its own mutation`);
  }
  return updated;
}
