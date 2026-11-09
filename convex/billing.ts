import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import { dueEvent, isWarningCurrent, WARNING_TEMPLATES, type WarningTemplate } from "./lib/billingLifecycle";
import {
  type BillingBanner,
  billingBanner,
  type WarningVariables,
  warningNotification,
  warningVariables,
} from "./lib/billingWarnings";
import { switchedStatus } from "./lib/engineSwitch";
import { engineAvailability } from "./lib/entitlementAccess";
import { ADD_ONS } from "./lib/entitlements";
import {
  engineSwitchRefusal,
  getEngine,
  MaintenanceApiError,
  type MaintenanceEngineStatus,
  sendTransactionalEmail,
  startEngine,
  stopEngine,
} from "./lib/maintenanceClient";
import {
  type BillingInterval,
  billingIntervalValidator,
  type PlanTier,
  planTierValidator,
  subscriptionStateValidator,
} from "./lib/organization";
import { orgCan, orgRoleOf, requireOrgActionFor } from "./lib/orgRoles";
import { orgPortalUrl, paymentsConfig } from "./lib/payments/config";
import {
  type AppliedDiscount,
  type CheckoutPurpose,
  type Invoice,
  type PaymentError,
  type PaymentProvider,
  providerSubscriptionValidator,
  type StrayPayment,
} from "./lib/payments/provider";
import { lifecycleEventFor, providerViewFor } from "./lib/payments/providerEvents";
import { paymentProvider } from "./lib/payments/registry";
import { closeSession, sessionByProviderId } from "./lib/payments/sessions";
import { applyTransition, lifecycleOf, subscriptionFor } from "./lib/subscriptions";
import { getInstanceMembership } from "./lib/teamAccess";
import { logger } from "./logger";
import { sendNotificationOnce } from "./notifications";
import schema from "./schema";

/** Orgs whose timers are due, scheduled per evaluator tick; the next tick takes the rest. */
const EVALUATOR_BATCH = 200;
/** Due events applied to one org per run; a well-formed lifecycle needs at most three in a row. */
const MAX_EVENTS_PER_ORG = 5;
const EVALUATOR = "evaluator";

const warningTemplateValidator = v.union(...WARNING_TEMPLATES.map((template) => v.literal(template)));
const stintValidator = v.object({ state: subscriptionStateValidator, stateSince: v.number() });

/**
 * The evaluator tick: schedules one evaluation per org with a timer due. Each
 * org runs in its own mutation, so one that fails never holds up the rest.
 */
export const evaluateDue = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("subscriptions")
      .withIndex("by_next_check", (q) => q.gte("nextCheckAt", 0).lte("nextCheckAt", now))
      .take(EVALUATOR_BATCH);
    for (const row of due) {
      await ctx.scheduler.runAfter(0, internal.billing.evaluateOrg, { accountId: row.accountId, now });
    }
    return { scheduled: due.length };
  },
});

/** Applies every timer of the org that is due at `now`, in order. Running it again is a no-op. */
export const evaluateOrg = internalMutation({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: async (ctx, { accountId, now }): Promise<{ applied: number }> => {
    let applied = 0;
    for (;;) {
      const row = await subscriptionFor(ctx, accountId);
      const event = row === null ? null : dueEvent(lifecycleOf(row), now);
      if (event === null) {
        return { applied };
      }
      if (applied === MAX_EVENTS_PER_ORG) {
        throw new Error(`evaluateOrg: ${accountId} still has ${event.kind} due after ${applied} events`);
      }
      const result = await applyTransition(ctx, { accountId, event, now, actor: EVALUATOR, origin: "signup" });
      if (!result.ok) {
        throw new Error(`evaluateOrg: ${accountId} timer ${event.kind} is illegal from ${result.error.from}`);
      }
      applied += 1;
    }
  },
});

/**
 * Sends one billing warning in-app: the owner gets it with a link to Billing,
 * org admins without. Skipped when the org has left the stint that scheduled
 * it. Idempotent on `${transitionId}:${template}`.
 */
export const deliverWarning = internalMutation({
  args: {
    accountId: v.id("accounts"),
    transitionId: v.id("subscriptionTransitions"),
    template: warningTemplateValidator,
    stint: stintValidator,
  },
  handler: async (ctx, { accountId, transitionId, template, stint }): Promise<{ sent: boolean }> => {
    const subscription = await subscriptionFor(ctx, accountId);
    if (subscription === null || !isWarningCurrent(stint, lifecycleOf(subscription))) {
      return { sent: false };
    }
    const account = await ctx.db.get(accountId);
    if (account === null) {
      throw new Error(`deliverWarning: org ${accountId} is gone but its subscription is not`);
    }
    const vars = warningVariables(template, account, subscription, Date.now());
    const requestId = `${transitionId}:${template}`;
    const sent = await sendNotificationOnce(ctx, {
      ...warningNotification(template, vars, "owner"),
      audience: { kind: "user", userId: account.ownerId },
      createdBy: EVALUATOR,
      requestId,
    });
    const members = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const member of members) {
      if (member.role === "admin" && member.userId !== account.ownerId) {
        await sendNotificationOnce(ctx, {
          ...warningNotification(template, vars, "admin"),
          audience: { kind: "user", userId: member.userId },
          createdBy: EVALUATOR,
          requestId: `${requestId}:${member.userId}`,
        });
      }
    }
    if (sent) {
      await scheduleWarningEmail(ctx, transitionId, template, account.ownerId, vars);
    }
    return { sent };
  },
});

/**
 * The email copy of a warning, to the owner, sent by an action so a failing
 * mail service never rolls back the transition or the in-app notice. An
 * owner without an email address (a Twitch-only account) gets in-app only,
 * which is noted on the transition.
 */
async function scheduleWarningEmail(
  ctx: MutationCtx,
  transitionId: Id<"subscriptionTransitions">,
  template: WarningTemplate,
  ownerId: Id<"users">,
  vars: WarningVariables
): Promise<void> {
  const owner = await ctx.db.get(ownerId);
  const to = owner?.email?.trim();
  if (to === undefined || to === "") {
    await ctx.db.patch(transitionId, { ownerEmailMissing: true });
    return;
  }
  await ctx.scheduler.runAfter(0, internal.billing.sendWarningEmail, {
    template,
    to,
    variables: { ...vars },
    idempotencyKey: `${transitionId}:${template}`,
    attempt: 0,
  });
}

/** Retries of a warning email that failed for a reason worth retrying, with capped exponential backoff. */
export const WARNING_EMAIL_RETRY = {
  maxAttempts: 6,
  baseDelayMs: 60_000,
  maxDelayMs: 60 * 60_000,
} as const;

function emailRetryDelay(attempt: number, jitter: number): number {
  const capped = Math.min(WARNING_EMAIL_RETRY.baseDelayMs * 2 ** attempt, WARNING_EMAIL_RETRY.maxDelayMs);
  return Math.round(capped * (0.5 + jitter / 2));
}

/** A refusal the same request would get again: a bad template, address or variables. */
function isPermanent(error: unknown): boolean {
  return error instanceof MaintenanceApiError && error.status >= 400 && error.status < 500 && error.status !== 429;
}

export const sendWarningEmail = internalAction({
  args: {
    template: warningTemplateValidator,
    to: v.string(),
    variables: v.object({ orgName: v.string(), planName: v.string(), dateIso: v.string() }),
    idempotencyKey: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    // A configuration error, not an outage: it fails here, loudly, rather than being retried.
    const billingUrl = `${orgPortalUrl()}/billing`;
    try {
      await sendTransactionalEmail(
        { template: args.template, to: args.to, variables: { ...args.variables, billingUrl } },
        args.idempotencyKey
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = args.attempt + 1;
      if (isPermanent(error) || next >= WARNING_EMAIL_RETRY.maxAttempts) {
        logger.error("billing warning email: giving up", {
          template: args.template,
          idempotencyKey: args.idempotencyKey,
          attempt: args.attempt,
          error: message,
        });
        return;
      }
      logger.warn("billing warning email: retrying", { template: args.template, attempt: next, error: message });
      await ctx.scheduler.runAfter(emailRetryDelay(args.attempt, Math.random()), internal.billing.sendWarningEmail, {
        ...args,
        attempt: next,
      });
    }
  },
});

/**
 * The billing banner for the engine the viewer is on, with whether they may
 * act on it (the owner). Null off hosted engines and when nothing is due.
 */
export const bannerForViewer = query({
  args: { instanceId: v.id("instances"), now: v.number() },
  handler: async (ctx, { instanceId, now }): Promise<(BillingBanner & { canManageBilling: boolean }) | null> => {
    const userId = await getAuthUserId(ctx);
    const instance = await ctx.db.get(instanceId);
    if (userId === null || instance === null || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const availability = await engineAvailability(ctx, instanceId, now);
    if (availability.availability !== "hosted") {
      return null;
    }
    const banner = billingBanner(availability.entitlements.subscription, now);
    const account = await ctx.db.get(instance.accountId);
    if (banner === null || account === null) {
      return null;
    }
    return { ...banner, canManageBilling: orgCan(await orgRoleOf(ctx, account, userId), "manageBilling") };
  },
});

/** Retries of an engine stop or start the maintenance API couldn't take yet (an upgrade running, an outage). */
export const ENGINE_EFFECT_RETRY = {
  baseDelayMs: 5 * 60_000,
  maxDelayMs: 6 * 60 * 60_000,
} as const;

/**
 * Capped exponential backoff with jitter (`jitter` in [0, 1)). It stays at
 * the cap while the effect still fits the subscription: a suspended org's
 * engines must stop, and a paying org's must start, however long it takes.
 */
export function engineRetryDelay(attempt: number, jitter: number): number {
  const capped = Math.min(ENGINE_EFFECT_RETRY.baseDelayMs * 2 ** attempt, ENGINE_EFFECT_RETRY.maxDelayMs);
  return Math.round(capped * (0.5 + jitter / 2));
}

/**
 * Retries of a stop the maintenance API took but whose run failed, for a
 * suspended org whose engines should be stopped. Each one is a new run, so
 * they are capped; the last failure is left for an operator.
 */
export const ENGINE_STOP_RETRY = {
  maxAttempts: 5,
} as const;

/** Whether a failed stop of this engine should be tried again: its org is suspended and past spin-down. */
async function stopStillWanted(ctx: QueryCtx, accountId: Id<"accounts">): Promise<boolean> {
  const subscription = await subscriptionFor(ctx, accountId);
  return subscription?.state === "suspended" && subscription.spinDownAt === undefined;
}

/**
 * After a failed stop of `row`: schedules the next retry while the org still
 * wants its engines stopped, or marks the engine as waiting for an operator
 * once the retries are used up. `jitter` is in [0, 1).
 */
export async function scheduleEngineStopRetry(
  ctx: MutationCtx,
  row: Doc<"engineProvisioning">,
  jitter: number
): Promise<void> {
  if (!(await stopStillWanted(ctx, row.accountId))) {
    return;
  }
  const attempt = row.stopRetries ?? 0;
  if (attempt >= ENGINE_STOP_RETRY.maxAttempts) {
    logger.error("billing engine stop: retries used up, needs an operator", {
      accountId: row.accountId,
      engineId: row.maintenanceEngineId,
      attempts: attempt,
    });
    await ctx.db.patch(row._id, {
      error: `${row.error ?? "stop failed"} (gave up after ${attempt} retries; stop it by hand)`,
    });
    return;
  }
  await ctx.db.patch(row._id, { stopRetries: attempt + 1 });
  await ctx.scheduler.runAfter(engineRetryDelay(attempt, jitter), internal.billing.retryEngineStop, {
    provisioningId: row._id,
    attempt,
  });
}

type EngineEffect = "stopEngines" | "resumeEngines";
const engineEffectValidator = v.union(v.literal("stopEngines"), v.literal("resumeEngines"));

/** Provisioning rows read per org. An org holds a handful of engines, so this is a backstop, not a page size. */
const ENGINES_PER_ORG_SCAN = 50;

interface ManagedEngine {
  provisioningId: Id<"engineProvisioning">;
  maintenanceEngineId: string;
  status: Doc<"engineProvisioning">["status"];
}

/**
 * Whether `transitionId` is the org's newest transition. An effect the
 * lifecycle issues again on a recheck is superseded by the newer issue, so
 * one org never runs two copies of it.
 */
async function isLatestTransition(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  transitionId: Id<"subscriptionTransitions">
): Promise<boolean> {
  const latest = await ctx.db
    .query("subscriptionTransitions")
    .withIndex("by_account_at", (q) => q.eq("accountId", accountId))
    .order("desc")
    .first();
  return latest?._id === transitionId;
}

/**
 * The org's managed engines an effect would act on, or null when the effect
 * no longer fits the subscription (a payment arrived before the stop ran, or
 * the org was suspended again before the start), or a recheck has issued the
 * stop again. Self-hosted engines have no provisioning row and are never
 * billed, locked or stopped.
 */
export const engineEffectTargets = internalQuery({
  args: { accountId: v.id("accounts"), transitionId: v.id("subscriptionTransitions"), effect: engineEffectValidator },
  handler: async (ctx, { accountId, transitionId, effect }): Promise<ManagedEngine[] | null> => {
    const subscription = await subscriptionFor(ctx, accountId);
    const wanted =
      effect === "stopEngines"
        ? subscription?.state === "suspended" &&
          subscription.spinDownAt === undefined &&
          (await isLatestTransition(ctx, accountId, transitionId))
        : subscription !== null && subscription.state !== "suspended";
    if (!wanted) {
      return null;
    }
    const rows = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .take(ENGINES_PER_ORG_SCAN);
    // A failed stop is left to its own retries, and once they are used up, to an operator.
    const ownedByStopRetries = (row: Doc<"engineProvisioning">) =>
      effect === "stopEngines" && row.status === "failed" && row.stopRetries !== undefined;
    return rows.flatMap((row) =>
      row.maintenanceEngineId === undefined || ownedByStopRetries(row)
        ? []
        : [{ provisioningId: row._id, maintenanceEngineId: row.maintenanceEngineId, status: row.status }]
    );
  },
});

const provisioningStatusValidator = schema.tables.engineProvisioning.validator.fields.status;

const engineSwitchMoveValidator = v.union(
  v.literal("stopRequested"),
  v.literal("stopped"),
  v.literal("startRequested"),
  v.literal("started"),
  v.literal("foundRunning"),
  v.literal("foundFailed"),
  v.literal("refused")
);

/** Applies a declared engine switch move; a row that has moved on since is left alone. */
export const switchEngineStatus = internalMutation({
  args: { provisioningId: v.id("engineProvisioning"), move: engineSwitchMoveValidator, error: v.optional(v.string()) },
  handler: async (ctx, { provisioningId, move, error }): Promise<boolean> => {
    const row = await ctx.db.get(provisioningId);
    const to = row === null ? null : switchedStatus(row.status, move);
    if (to === null) {
      return false;
    }
    await ctx.db.patch(provisioningId, { status: to, error, updatedAt: Date.now() });
    return true;
  },
});

/**
 * Takes back a stop or start request the maintenance API refused without
 * touching the engine (another run under way): the row goes back to the
 * status it had, so that run's callbacks find the engine as they left it.
 */
export const withdrawEngineSwitch = internalMutation({
  args: {
    provisioningId: v.id("engineProvisioning"),
    requested: v.union(v.literal("stopping"), v.literal("starting")),
    previous: provisioningStatusValidator,
  },
  handler: async (ctx, { provisioningId, requested, previous }): Promise<void> => {
    const row = await ctx.db.get(provisioningId);
    if (row?.status === requested) {
      await ctx.db.patch(provisioningId, { status: previous, updatedAt: Date.now() });
    }
  },
});

/**
 * Stops or starts the org's managed engines with its subscription. Each call
 * is keyed `${transitionId}:${engineId}`, so a retry asks the maintenance API
 * for the same run. An engine already stopped is not stopped again; only
 * stopped engines are started. Engines the API couldn't take yet are retried
 * with backoff while the effect still fits the subscription, and so is the
 * whole effect when this run fails part-way: a lost effect would leave a
 * suspended org's engines running or a paying org's stopped.
 */
export const runEngineEffect = internalAction({
  args: {
    accountId: v.id("accounts"),
    transitionId: v.id("subscriptionTransitions"),
    effect: engineEffectValidator,
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ acted: number; pending: number } | null> => {
    let outcome: { acted: number; pending: number } | null = null;
    try {
      outcome = await switchOrgEngines(ctx, args);
    } catch (error) {
      logger.error("billing engine effect: failed, will retry", {
        accountId: args.accountId,
        effect: args.effect,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (outcome === null || outcome.pending > 0) {
      const attempt = args.attempt ?? 0;
      await ctx.scheduler.runAfter(engineRetryDelay(attempt, Math.random()), internal.billing.runEngineEffect, {
        ...args,
        attempt: attempt + 1,
      });
    }
    return outcome;
  },
});

async function switchOrgEngines(
  ctx: ActionCtx,
  args: { accountId: Id<"accounts">; transitionId: Id<"subscriptionTransitions">; effect: EngineEffect }
): Promise<{ acted: number; pending: number }> {
  const targets = await ctx.runQuery(internal.billing.engineEffectTargets, {
    accountId: args.accountId,
    transitionId: args.transitionId,
    effect: args.effect,
  });
  if (targets === null) {
    return { acted: 0, pending: 0 };
  }
  let acted = 0;
  let pending = 0;
  for (const engine of targets) {
    const outcome = await switchEngine(ctx, args.effect, engine, `${args.transitionId}:${engine.maintenanceEngineId}`);
    if (outcome === "acted") {
      acted += 1;
    } else if (outcome === "retry") {
      pending += 1;
    }
  }
  return { acted, pending };
}

/** The engine a stop retry acts on, or null when it no longer needs stopping or the org no longer wants it. */
export const engineStopRetryTarget = internalQuery({
  args: { provisioningId: v.id("engineProvisioning") },
  handler: async (ctx, { provisioningId }): Promise<ManagedEngine | null> => {
    const row = await ctx.db.get(provisioningId);
    if (row?.status !== "failed" || row.maintenanceEngineId === undefined) {
      return null;
    }
    if (!(await stopStillWanted(ctx, row.accountId))) {
      return null;
    }
    return { provisioningId: row._id, maintenanceEngineId: row.maintenanceEngineId, status: row.status };
  },
});

/** A stop retry the maintenance API didn't take: the engine is failed again and the next retry is scheduled. */
export const recordEngineStopFailure = internalMutation({
  args: { provisioningId: v.id("engineProvisioning"), error: v.string() },
  handler: async (ctx, { provisioningId, error }): Promise<void> => {
    const row = await ctx.db.get(provisioningId);
    if (row === null || (row.status !== "stopping" && row.status !== "failed")) {
      return;
    }
    await ctx.db.patch(provisioningId, { status: "failed", error, updatedAt: Date.now() });
    await scheduleEngineStopRetry(ctx, { ...row, status: "failed", error }, Math.random());
  },
});

/** Asks the maintenance API again to stop an engine whose stop run failed. Each attempt is its own run. */
export const retryEngineStop = internalAction({
  args: { provisioningId: v.id("engineProvisioning"), attempt: v.number() },
  handler: async (ctx, { provisioningId, attempt }): Promise<void> => {
    const engine = await ctx.runQuery(internal.billing.engineStopRetryTarget, { provisioningId });
    if (engine === null) {
      return;
    }
    let outcome: "acted" | "skipped" | "retry";
    try {
      outcome = await switchEngine(ctx, "stopEngines", engine, `stop-retry:${provisioningId}:${attempt}`);
    } catch (error) {
      logger.error("billing engine stop retry: failed", {
        provisioningId,
        error: error instanceof Error ? error.message : String(error),
      });
      outcome = "retry";
    }
    if (outcome === "retry") {
      await ctx.runMutation(internal.billing.recordEngineStopFailure, {
        provisioningId,
        error: "stop: the maintenance API didn't take the retry",
      });
    }
  },
});

/** Why a refusal that retrying can't fix left the engine failed, for the row's error. */
const REFUSAL_REASONS: Record<"engine_not_ready" | "not_customer_engine", string> = {
  engine_not_ready: "the maintenance API can't stop the engine from its current state (engine_not_ready)",
  not_customer_engine:
    "the maintenance API says this isn't a customer engine, so billing can't switch it (not_customer_engine)",
};

async function switchEngine(
  ctx: ActionCtx,
  effect: EngineEffect,
  engine: ManagedEngine,
  idempotencyKey: string
): Promise<"acted" | "skipped" | "retry"> {
  const stopping = effect === "stopEngines";
  if (!stopping && engine.status === "stopping") {
    // A stop still running settles first (engine.stopped); the start goes out on a retry after it.
    return "retry";
  }
  // Recorded before the call, so the row never claims less than was asked of the maintenance API.
  const requested = await ctx.runMutation(internal.billing.switchEngineStatus, {
    provisioningId: engine.provisioningId,
    move: stopping ? "stopRequested" : "startRequested",
  });
  if (!requested) {
    return "skipped";
  }
  try {
    if (stopping) {
      await stopEngine(engine.maintenanceEngineId, idempotencyKey);
    } else {
      await startEngine(engine.maintenanceEngineId, idempotencyKey);
    }
  } catch (error) {
    const refusal = engineSwitchRefusal(error);
    if (refusal === "engine_not_stopped") {
      return catchUpWithEngine(ctx, engine);
    }
    if (refusal === "engine_not_ready" || refusal === "not_customer_engine") {
      await ctx.runMutation(internal.billing.switchEngineStatus, {
        provisioningId: engine.provisioningId,
        move: "refused",
        error: `${stopping ? "stop" : "start"}: ${REFUSAL_REASONS[refusal]}`,
      });
      return "skipped";
    }
    if (refusal === "run_in_progress") {
      await ctx.runMutation(internal.billing.withdrawEngineSwitch, {
        provisioningId: engine.provisioningId,
        requested: stopping ? "stopping" : "starting",
        previous: engine.status,
      });
    }
    logger.warn("billing engine effect: will retry", {
      effect,
      engineId: engine.maintenanceEngineId,
      reason: refusal ?? (error instanceof Error ? error.message : String(error)),
    });
    return "retry";
  }
  return "acted";
}

/**
 * A start refused because the engine isn't stopped: the row catches up with
 * what the maintenance API reports. A running engine is registered again; a
 * failed one is failed, for provisioning.retry; anything else (a run still
 * going) is asked again later.
 */
async function catchUpWithEngine(ctx: ActionCtx, engine: ManagedEngine): Promise<"skipped" | "retry"> {
  let status: MaintenanceEngineStatus;
  try {
    status = (await getEngine(engine.maintenanceEngineId)).engine.status;
  } catch (error) {
    logger.warn("billing engine effect: couldn't read a refused engine, will retry", {
      engineId: engine.maintenanceEngineId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "retry";
  }
  if (status === "ready") {
    await ctx.runMutation(internal.billing.switchEngineStatus, {
      provisioningId: engine.provisioningId,
      move: "foundRunning",
    });
    return "skipped";
  }
  if (status === "failed") {
    await ctx.runMutation(internal.billing.switchEngineStatus, {
      provisioningId: engine.provisioningId,
      move: "foundFailed",
      error: "start: the engine is failed, so it couldn't be started",
    });
    return "skipped";
  }
  return "retry";
}

// ---------------------------------------------------------------------------
// Renewal check: one request to the provider before an active org whose
// period end passed is deactivated
// ---------------------------------------------------------------------------

/** Retries of a renewal check the provider couldn't answer yet, with capped exponential backoff. */
export const RENEWAL_CHECK_RETRY = {
  baseDelayMs: 5 * 60_000,
  maxDelayMs: 6 * 60 * 60_000,
} as const;

/** Capped exponential backoff with jitter (`jitter` in [0, 1)); it stays at the cap until the provider answers. */
export function renewalRetryDelay(attempt: number, jitter: number): number {
  const capped = Math.min(RENEWAL_CHECK_RETRY.baseDelayMs * 2 ** attempt, RENEWAL_CHECK_RETRY.maxDelayMs);
  return Math.round(capped * (0.5 + jitter / 2));
}

/**
 * The provider subscription an active org is waiting on a renewal check for,
 * or null when there is nothing to check: the org left active, a renewal set
 * its next billing date again, or a recheck issued the check again.
 */
export const renewalCheckTarget = internalQuery({
  args: { accountId: v.id("accounts"), transitionId: v.id("subscriptionTransitions") },
  handler: async (ctx, { accountId, transitionId }): Promise<string | null> => {
    const row = await subscriptionFor(ctx, accountId);
    if (
      row?.state !== "active" ||
      row.nextBillingAt !== undefined ||
      !(await isLatestTransition(ctx, accountId, transitionId))
    ) {
      return null;
    }
    if (row.providerSubscriptionId === undefined) {
      throw new Error(`renewalCheckTarget: active subscription ${row._id} has no provider subscription`);
    }
    return row.providerSubscriptionId;
  },
});

export interface RenewalCheckDeps {
  provider: PaymentProvider;
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
  now: () => number;
}

/**
 * Asks the provider about the org's subscription and applies the answer
 * through the usual path: renewed stays active, ended or failed takes the
 * lifecycle's path for that. "retry" when the provider couldn't say yet
 * (unreachable, or the renewal not yet charged), leaving the org as it is.
 */
export async function checkRenewal(
  deps: RenewalCheckDeps,
  accountId: Id<"accounts">,
  transitionId: Id<"subscriptionTransitions">
): Promise<"settled" | "retry"> {
  const subscriptionRef = await deps.runQuery(internal.billing.renewalCheckTarget, { accountId, transitionId });
  if (subscriptionRef === null) {
    return "settled";
  }
  const fetched = await deps.provider.fetchSubscription(subscriptionRef);
  if (!fetched.ok) {
    logger.warn("billing renewal check: provider unavailable, will retry", { accountId, code: fetched.error.code });
    return "retry";
  }
  const subscription = fetched.value;
  if (subscription === null || (subscription.standing === "good" && subscription.currentPeriodEnd <= deps.now())) {
    logger.info("billing renewal check: not renewed yet, will retry", { accountId, subscriptionRef });
    return "retry";
  }
  await deps.runMutation(internal.billing.applyProviderSubscription, { subscription });
  return (await deps.runQuery(internal.billing.renewalCheckTarget, { accountId, transitionId })) === null
    ? "settled"
    : "retry";
}

export const confirmRenewal = internalAction({
  args: { accountId: v.id("accounts"), transitionId: v.id("subscriptionTransitions"), attempt: v.number() },
  handler: async (ctx, { accountId, transitionId, attempt }): Promise<void> => {
    let outcome: "settled" | "retry";
    try {
      outcome = await checkRenewal(
        {
          provider: paymentProvider(paymentsConfig()),
          runQuery: ctx.runQuery,
          runMutation: ctx.runMutation,
          now: Date.now,
        },
        accountId,
        transitionId
      );
    } catch (error) {
      // Never deactivate on our own failure: the org stays active and the check runs again.
      logger.error("billing renewal check: failed, will retry", {
        accountId,
        error: error instanceof Error ? error.message : String(error),
      });
      outcome = "retry";
    }
    if (outcome === "retry") {
      await ctx.scheduler.runAfter(renewalRetryDelay(attempt, Math.random()), internal.billing.confirmRenewal, {
        accountId,
        transitionId,
        attempt: attempt + 1,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Checkout, promotion codes and the customer portal (owner only)
// ---------------------------------------------------------------------------

const PROVIDER_ACTOR = "provider:stripe";

/** What a billing action needs to know about the org, for a caller allowed to manage its billing. */
export const billingContext = internalQuery({
  args: { accountId: v.id("accounts"), userId: v.id("users") },
  handler: async (ctx, { accountId, userId }): Promise<{ customerRef: string | null; paidUp: boolean }> => {
    await requireOrgActionFor(ctx, accountId, userId, "manageBilling");
    const subscription = await subscriptionFor(ctx, accountId);
    return {
      customerRef: subscription?.providerCustomerId ?? null,
      paidUp: subscription?.providerSubscriptionId !== undefined && subscription.providerStanding === "good",
    };
  },
});

async function requireBillingManager(ctx: ActionCtx, accountId: Id<"accounts">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ code: "not_authenticated", message: "Not authenticated" });
  }
  const context: { customerRef: string | null; paidUp: boolean } = await ctx.runQuery(internal.billing.billingContext, {
    accountId,
    userId,
  });
  return context;
}

function providerFailure(error: PaymentError): ConvexError<PaymentError> {
  return new ConvexError<PaymentError>(error);
}

// stylegate:ignore ANY-LAY-004 reason="A Convex action handler is the composition root: no process outlives one call to inject a shared client from"
function configuredProvider(): { provider: PaymentProvider; portalUrl: string } {
  const config = paymentsConfig();
  return { provider: paymentProvider(config), portalUrl: config.ORG_PORTAL_URL };
}

/**
 * One checkout attempt per org and terms at a time: every request for the
 * same plan, interval and promotion code in the same window shares an
 * idempotency key, so the provider hands concurrent and repeated requests the
 * one session the first opened. Other terms get their own session, and
 * opening it expires the older one, so only the newest can be paid. The
 * session's expiry is derived from the window too, because a replay must
 * repeat every parameter.
 */
export const CHECKOUT_ATTEMPT = {
  windowMs: 30 * 60_000,
  // Keeps the expiry clear of Stripe's 30-minute minimum, which it measures from session creation.
  expiryMarginMs: 5 * 60_000,
} as const;

/** The key and expiry of the org's checkout attempt for `purpose` at `nowMs`; the expiry lands 35-65 minutes out. */
export function checkoutAttempt(
  purpose: Extract<CheckoutPurpose, { kind: "subscription" }>,
  nowMs: number
): { idempotencyKey: string; expiresAt: number } {
  const windowStart = Math.floor(nowMs / CHECKOUT_ATTEMPT.windowMs) * CHECKOUT_ATTEMPT.windowMs;
  const terms = [purpose.plan, purpose.interval, encodeURIComponent(purpose.promotionCode ?? "")].join(":");
  return {
    idempotencyKey: `checkout:${purpose.accountId}:${terms}:${windowStart}`,
    expiresAt: windowStart + 2 * CHECKOUT_ATTEMPT.windowMs + CHECKOUT_ATTEMPT.expiryMarginMs,
  };
}

export interface CheckoutArgs {
  accountId: Id<"accounts">;
  plan: PlanTier;
  interval: BillingInterval;
  promotionCode?: string;
}

export interface CheckoutDeps {
  provider: PaymentProvider;
  runMutation: ActionCtx["runMutation"];
  portalUrl: string;
}

/**
 * Opens (or replays) the org's subscription checkout with the provider,
 * records it in `paymentSessions`, and expires every older session still open
 * for the org, so only the newest can be paid. A superseded session the
 * provider no longer holds open (paid or expired meanwhile) is left to its
 * own webhook.
 */
export async function openSubscriptionCheckout(
  deps: CheckoutDeps,
  customerRef: string | null,
  { accountId, plan, interval, promotionCode }: CheckoutArgs,
  nowMs: number
): Promise<{ url: string }> {
  const purpose: Extract<CheckoutPurpose, { kind: "subscription" }> = {
    kind: "subscription",
    accountId,
    plan,
    interval,
    promotionCode: promotionCode?.trim() || null,
  };
  const result = await deps.provider.createCheckout({
    purpose,
    customerRef,
    allowPromotionCodes: true,
    successUrl: `${deps.portalUrl}/billing?checkout=done`,
    cancelUrl: `${deps.portalUrl}/billing`,
    ...checkoutAttempt(purpose, nowMs),
  });
  if (!result.ok && result.error.code === "checkout_in_progress") {
    throw new ConvexError<PaymentError>({
      code: "checkout_in_progress",
      message: "A checkout for this organization is already open. Finish it, or start again in half an hour.",
    });
  }
  if (!result.ok) {
    throw providerFailure(result.error);
  }
  const { open, supersededSessionRefs } = await deps.runMutation(internal.payments.recordCheckout, {
    purpose,
    session: result.value,
    now: nowMs,
  });
  if (!open) {
    // The provider replayed a session a checkout for other terms has since replaced; its URL leads nowhere.
    throw new ConvexError<PaymentError>({
      code: "checkout_in_progress",
      message: "That checkout was replaced by a newer one. Finish the newer one, or start again in half an hour.",
    });
  }
  for (const sessionRef of supersededSessionRefs) {
    const expired = await deps.provider.expireCheckout(sessionRef);
    if (!expired.ok && expired.error.code !== "invalid_request") {
      // The older session is still payable: refuse to hand out a second one. A retry replays this checkout.
      throw providerFailure(expired.error);
    }
    if (expired.ok) {
      await deps.runMutation(internal.payments.expireSession, { providerSessionId: sessionRef, now: nowMs });
    } else {
      logger.warn("billing checkout: superseded session no longer open at the provider", {
        accountId,
        sessionRef,
        error: expired.error.message,
      });
    }
  }
  return { url: result.value.url };
}

/** A provider checkout for a plan, for an org with no subscription in good standing. Returns its URL. */
export const startCheckout = action({
  args: {
    accountId: v.id("accounts"),
    plan: planTierValidator,
    interval: billingIntervalValidator,
    promotionCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const context = await requireBillingManager(ctx, args.accountId);
    if (context.paidUp) {
      throw new ConvexError({
        code: "already_subscribed",
        message: "This organization already has a subscription. Change it in Manage billing.",
      });
    }
    const { provider, portalUrl } = configuredProvider();
    return openSubscriptionCheckout(
      { provider, runMutation: ctx.runMutation, portalUrl },
      context.customerRef,
      args,
      Date.now()
    );
  },
});

/** What a promotion code would take off, before checkout; null when it doesn't exist or is inactive. */
export const previewPromotionCode = action({
  args: { accountId: v.id("accounts"), code: v.string() },
  handler: async (ctx, { accountId, code }): Promise<AppliedDiscount | null> => {
    await requireBillingManager(ctx, accountId);
    const trimmed = code.trim();
    if (trimmed === "") {
      return null;
    }
    const result = await configuredProvider().provider.lookupPromotionCode(trimmed);
    if (!result.ok) {
      throw providerFailure(result.error);
    }
    return result.value;
  },
});

/** The provider's customer portal, where plan, interval, payment method and cancellation change. */
export const openPortal = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<{ url: string }> => {
    const context = await requireBillingManager(ctx, accountId);
    if (context.customerRef === null) {
      throw new ConvexError({ code: "no_customer", message: "Choose a plan first; there is nothing to manage yet." });
    }
    const { provider, portalUrl } = configuredProvider();
    const result = await provider.createPortalSession({
      customerRef: context.customerRef,
      returnUrl: `${portalUrl}/billing`,
    });
    if (!result.ok) {
      throw providerFailure(result.error);
    }
    return result.value;
  },
});

/** How many invoices the portal lists; older ones are in the provider's portal. */
export const INVOICE_PAGE_SIZE = 24;

/** The customer whose invoices the caller may read, as an org owner; `allowed` false for anyone else. */
export const invoiceCustomer = internalQuery({
  args: { accountId: v.id("accounts"), userId: v.id("users") },
  handler: async (ctx, { accountId, userId }): Promise<{ allowed: boolean; customerRef: string | null }> => {
    const account = await ctx.db.get(accountId);
    if (account === null || !orgCan(await orgRoleOf(ctx, account, userId), "manageBilling")) {
      return { allowed: false, customerRef: null };
    }
    return { allowed: true, customerRef: (await subscriptionFor(ctx, accountId))?.providerCustomerId ?? null };
  },
});

/** The customer's newest invoices, read live: woofx3 stores none. */
export async function listOrgInvoices(provider: PaymentProvider, customerRef: string): Promise<Invoice[]> {
  const result = await provider.listInvoices(customerRef, INVOICE_PAGE_SIZE);
  if (!result.ok) {
    throw providerFailure(result.error);
  }
  return result.value;
}

/** The org's invoices for its owner; null for anyone else, so the portal hides the page. */
export const invoices = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Invoice[] | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const customer: { allowed: boolean; customerRef: string | null } = await ctx.runQuery(
      internal.billing.invoiceCustomer,
      { accountId, userId }
    );
    if (!customer.allowed) {
      return null;
    }
    if (customer.customerRef === null) {
      return [];
    }
    return listOrgInvoices(configuredProvider().provider, customer.customerRef);
  },
});

// ---------------------------------------------------------------------------
// Provider webhooks
// ---------------------------------------------------------------------------

/** A provider subscription read as a function argument, with the org it is applied to. */
type SubscriptionRead = Infer<typeof providerSubscriptionValidator> & { accountId: Id<"accounts"> };

/** What applying the provider's truth about a subscription did. */
type SubscriptionOutcome = {
  outcome: "applied" | "ignored" | "stray";
  error?: string;
  accountId?: Id<"accounts">;
  /** Set exactly when the outcome is "stray". */
  stray?: StrayPayment;
};

/**
 * Applies the provider's truth about a subscription the org's row already
 * follows: from a webhook about it, or the renewal check. Only a paid
 * checkout of ours binds a new subscription to an org
 * (completeSubscriptionCheckout), so the provider's metadata alone never
 * grants anything.
 */
export const applyProviderSubscription = internalMutation({
  args: { subscription: providerSubscriptionValidator },
  handler: async (ctx, { subscription: read }): Promise<SubscriptionOutcome> => {
    const accountId = ctx.db.normalizeId("accounts", read.accountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { outcome: "ignored", error: `no org ${read.accountId} for subscription ${read.subscriptionRef}` };
    }
    return applySubscriptionRead(ctx, { ...read, accountId }, { mayBind: false });
  },
});

/**
 * Applies a paid subscription checkout: the session row names the org, the
 * subscription it bought is bound to that org, and the session is complete,
 * in one transaction, so a failure leaves the session open for redelivery.
 */
export const completeSubscriptionCheckout = internalMutation({
  args: { providerSessionId: v.string(), subscription: providerSubscriptionValidator, now: v.number() },
  handler: async (ctx, { providerSessionId, subscription: read, now }): Promise<SubscriptionOutcome> => {
    const session = await sessionByProviderId(ctx, providerSessionId);
    if (session === null || session.state !== "open") {
      return { outcome: "ignored", error: `session ${providerSessionId} is ${session?.state ?? "not ours"}` };
    }
    if (session.purpose.kind !== "subscription") {
      throw new Error(`completeSubscriptionCheckout: session ${providerSessionId} is for ${session.purpose.kind}`);
    }
    const accountId = session.purpose.accountId;
    if (read.accountId !== accountId) {
      logger.error("billing checkout: subscription names another org than its checkout", {
        providerSessionId,
        subscriptionRef: read.subscriptionRef,
        checkoutAccountId: accountId,
        subscriptionAccountId: read.accountId,
      });
      return {
        outcome: "stray",
        error: `subscription ${read.subscriptionRef} names org ${read.accountId}, its checkout was for ${accountId}`,
        accountId,
        stray: {
          subscriptionRef: read.subscriptionRef,
          customerRef: read.customerRef,
          amountCents: session.amountCents,
        },
      };
    }
    const result = await applySubscriptionRead(ctx, { ...read, accountId }, { mayBind: true });
    await closeSession(ctx, session, "complete", now);
    // The checkout knows what the stray subscription charged.
    return result.stray === undefined
      ? result
      : { ...result, stray: { ...result.stray, amountCents: session.amountCents } };
  },
});

/**
 * The lifecycle event the provider's standing means, then the provider mirror
 * on the row. A read no newer than the last one applied is stale and changes
 * nothing. An event the lifecycle has no transition for still updates the
 * mirror, so operators see it.
 */
async function applySubscriptionRead(
  ctx: MutationCtx,
  subscription: SubscriptionRead,
  { mayBind }: { mayBind: boolean }
): Promise<SubscriptionOutcome> {
  const { accountId } = subscription;
  const unknownAddOn = subscription.addOns.find((key) => !Object.keys(ADD_ONS).includes(key));
  if (unknownAddOn !== undefined) {
    throw new Error(`Provider subscription ${subscription.subscriptionRef} has unknown add-on ${unknownAddOn}`);
  }
  const before = await subscriptionFor(ctx, accountId);
  if (before?.providerSubscriptionId !== subscription.subscriptionRef) {
    // The row follows one provider subscription. Another one replaces it only
    // once it has ended, so a late event about an old, ended subscription
    // can't suspend an org that has subscribed again. A second live one is a
    // double charge for an operator to settle, never silently dropped.
    const followsAnother = before?.providerSubscriptionId !== undefined && before.providerStanding !== "ended";
    if (followsAnother && subscription.standing !== "ended") {
      logger.error("billing: a second live subscription for an org", {
        accountId,
        subscriptionRef: subscription.subscriptionRef,
        currentSubscriptionRef: before?.providerSubscriptionId,
      });
      return {
        outcome: "stray",
        error: `subscription ${subscription.subscriptionRef} is live beside the org's current ${before?.providerSubscriptionId}`,
        accountId,
        stray: {
          subscriptionRef: subscription.subscriptionRef,
          customerRef: subscription.customerRef,
          amountCents: null,
        },
      };
    }
    if (followsAnother || !mayBind) {
      return {
        outcome: "ignored",
        error: `subscription ${subscription.subscriptionRef} is not the one the org's row follows`,
        accountId,
      };
    }
  }
  if (before?.providerSyncedAt !== undefined && subscription.observedAt <= before.providerSyncedAt) {
    return { outcome: "ignored", error: "stale: an equal or newer provider read was applied already", accountId };
  }
  const result = await applyTransition(ctx, {
    accountId: subscription.accountId,
    event: lifecycleEventFor(before?.state ?? null, subscription),
    now: subscription.observedAt,
    actor: PROVIDER_ACTOR,
    origin: "signup",
    provider: providerViewFor(subscription),
  });
  // An illegal event from an org with no row leaves nothing to mirror onto.
  const row = result.ok ? result.subscription : before;
  if (row !== null) {
    await ctx.db.patch(row._id, {
      interval: subscription.interval,
      addOns: subscription.addOns,
      discount: subscription.discount ?? undefined,
      provider: "stripe",
      providerCustomerId: subscription.customerRef,
      providerSubscriptionId: subscription.subscriptionRef,
      providerStatus: subscription.providerStatus,
      providerStanding: subscription.standing,
      providerEndedReason: subscription.endedReason ?? undefined,
      providerPeriodEnd: subscription.currentPeriodEnd,
      providerSyncedAt: subscription.observedAt,
    });
  }
  if (!result.ok) {
    return { outcome: "ignored", error: `${result.error.event} is illegal from ${result.error.from}`, accountId };
  }
  return { outcome: "applied", accountId };
}
