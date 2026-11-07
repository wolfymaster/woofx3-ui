import { type Infer, v } from "convex/values";
import type { PlanTier, SubscriptionState } from "./organization";

// The billing lifecycle of one organization: a pure state machine over its
// subscription, with the clock passed in. Convex code (billing.ts) loads the
// subscription, calls `transition`, writes the result and schedules the
// effects in one mutation, so a change and its effects commit together.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const BILLING_LIFECYCLE = {
  // The trial is 30 days of Starter and needs no card.
  trialDays: 30,
  // Existing engines: their first billing evaluation is 30 days after migration.
  migrationBillingDelayDays: 30,
  // past_due becomes suspended this long after entering it.
  pastDueGraceDays: 14,
  // Re-evaluations after the first failure; the last gap repeats until grace ends.
  retryOffsetsHours: [24, 72, 168],
  warningOffsetsDays: {
    // trialing or migration: days before nextBillingAt.
    beforeBilling: [7, 3, 1],
    // Days after entering past_due.
    pastDue: [0, 3, 7, 12],
    // Days after suspension: 0 says "suspended", 5 says "engines stop in 2 days".
    beforeSpinDown: [0, 5],
  },
  // suspended: managed engines stop this long after suspension.
  spinDownGraceDays: 7,
  evaluatorIntervalMinutes: 15,
} as const;

export const lifecycleReasonValidator = v.union(
  v.literal("no_payment_method"),
  v.literal("payment_failed"),
  v.literal("subscription_canceled"),
  v.literal("provider_ended"),
  v.literal("operator")
);
export type LifecycleReason = Infer<typeof lifecycleReasonValidator>;

export const EVENT_KINDS = [
  "TrialStarted",
  "EvaluationDue",
  "RetryDue",
  "GraceExpired",
  "SpinDownDue",
  "ExemptionExpired",
  "ProviderActivated",
  "PaymentSucceeded",
  "PaymentFailed",
  "ProviderEnded",
  "ExemptionGranted",
  "ExemptionRevoked",
  "OperatorSuspended",
] as const;

export const lifecycleEventKindValidator = v.union(
  v.literal("TrialStarted"),
  v.literal("EvaluationDue"),
  v.literal("RetryDue"),
  v.literal("GraceExpired"),
  v.literal("SpinDownDue"),
  v.literal("ExemptionExpired"),
  v.literal("ProviderActivated"),
  v.literal("PaymentSucceeded"),
  v.literal("PaymentFailed"),
  v.literal("ProviderEnded"),
  v.literal("ExemptionGranted"),
  v.literal("ExemptionRevoked"),
  v.literal("OperatorSuspended")
);
export type LifecycleEventKind = Infer<typeof lifecycleEventKindValidator>;

export type ProviderEndedReason = "subscription_canceled" | "provider_ended";

export type LifecycleEvent =
  | { kind: "TrialStarted"; billingDelayDays: number }
  | { kind: "EvaluationDue" }
  | { kind: "RetryDue" }
  | { kind: "GraceExpired" }
  | { kind: "SpinDownDue" }
  | { kind: "ExemptionExpired" }
  | { kind: "ProviderActivated"; plan: PlanTier; currentPeriodEnd: number }
  | { kind: "PaymentSucceeded"; plan: PlanTier; currentPeriodEnd: number }
  | { kind: "PaymentFailed" }
  | { kind: "ProviderEnded"; reason: ProviderEndedReason }
  | { kind: "ExemptionGranted"; plan: PlanTier; until: number | null }
  | { kind: "ExemptionRevoked" }
  | { kind: "OperatorSuspended" };

export const WARNING_TEMPLATES = [
  "billing-trial-ending",
  "billing-payment-needed",
  "billing-payment-failed",
  "billing-suspended",
  "billing-engines-stopping",
  "billing-engines-stopped",
  "billing-reactivated",
] as const;
export type WarningTemplate = (typeof WARNING_TEMPLATES)[number];

/** A stretch of time in one state; a warning belongs to the stint that scheduled it. */
export interface Stint {
  state: SubscriptionState;
  stateSince: number;
}

export type LifecycleEffect =
  | { kind: "notifyOwner"; template: WarningTemplate; at: number; stint: Stint }
  // Ask the provider once whether an active subscription past its period end renewed.
  | { kind: "confirmRenewal" }
  | { kind: "stopEngines" }
  | { kind: "resumeEngines" };

/** The lifecycle fields of a `subscriptions` row. An undefined timer is not set. */
export interface Lifecycle {
  state: SubscriptionState;
  plan: PlanTier;
  stateReason: LifecycleReason | undefined;
  stateSince: number;
  trialStartedAt: number | undefined;
  nextBillingAt: number | undefined;
  graceEndsAt: number | undefined;
  nextRetryAt: number | undefined;
  exemptUntil: number | undefined;
  spinDownAt: number | undefined;
  nextCheckAt: number | undefined;
}

export const providerStandingValidator = v.union(v.literal("good"), v.literal("payment_failed"), v.literal("ended"));
export type ProviderStanding = Infer<typeof providerStandingValidator>;

/** What the provider last said about the org's subscription, or null when it has none. */
export type ProviderView = {
  standing: ProviderStanding;
  endedReason: ProviderEndedReason | null;
  currentPeriodEnd: number;
} | null;

export interface TransitionContext {
  now: number;
  provider: ProviderView;
}

export type TransitionResult =
  | { ok: true; next: Lifecycle; reason: LifecycleReason | undefined; effects: LifecycleEffect[] }
  | { ok: false; error: { code: "illegal_transition"; from: SubscriptionState | "none"; event: LifecycleEventKind } };

// ---------------------------------------------------------------------------
// Billing evaluation
// ---------------------------------------------------------------------------

export type Evaluation = { ok: true; currentPeriodEnd: number } | { ok: false; reason: LifecycleReason };

/** Whether the org is paid up: a provider subscription in good standing. */
export function evaluateBilling(provider: ProviderView): Evaluation {
  if (provider === null) {
    return { ok: false, reason: "no_payment_method" };
  }
  switch (provider.standing) {
    case "good":
      return { ok: true, currentPeriodEnd: provider.currentPeriodEnd };
    case "payment_failed":
      return { ok: false, reason: "payment_failed" };
    case "ended":
      return { ok: false, reason: provider.endedReason ?? "provider_ended" };
  }
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

const TIMER_FIELDS = ["nextBillingAt", "graceEndsAt", "nextRetryAt", "exemptUntil", "spinDownAt"] as const;

/** The earliest set timer: the only field the evaluator reads. */
export function nextCheckAt(lifecycle: Omit<Lifecycle, "nextCheckAt">): number | undefined {
  const set = TIMER_FIELDS.map((field) => lifecycle[field]).filter((at): at is number => at !== undefined);
  return set.length === 0 ? undefined : Math.min(...set);
}

/**
 * The next re-evaluation of a past_due stint after `now`: each offset after
 * the stint began, then the last gap repeating. None at or after grace end,
 * where GraceExpired takes over.
 */
export function nextRetryAt(pastDueSince: number, graceEndsAt: number, now: number): number | undefined {
  const offsets = BILLING_LIFECYCLE.retryOffsetsHours.map((hours) => pastDueSince + hours * HOUR_MS);
  let next = offsets.find((at) => at > now);
  if (next === undefined) {
    const last = BILLING_LIFECYCLE.retryOffsetsHours[BILLING_LIFECYCLE.retryOffsetsHours.length - 1] * HOUR_MS;
    const lastAt = offsets[offsets.length - 1];
    next = lastAt + Math.ceil((now - lastAt + 1) / last) * last;
  }
  return next < graceEndsAt ? next : undefined;
}

/** The timer the evaluator should act on now, in order of precedence, or null when none is due. */
export function dueEvent(lifecycle: Lifecycle, now: number): LifecycleEvent | null {
  if (lifecycle.spinDownAt !== undefined && lifecycle.spinDownAt <= now) {
    return { kind: "SpinDownDue" };
  }
  if (lifecycle.graceEndsAt !== undefined && lifecycle.graceEndsAt <= now) {
    return { kind: "GraceExpired" };
  }
  if (lifecycle.exemptUntil !== undefined && lifecycle.exemptUntil <= now) {
    return { kind: "ExemptionExpired" };
  }
  if (lifecycle.nextRetryAt !== undefined && lifecycle.nextRetryAt <= now) {
    return { kind: "RetryDue" };
  }
  if (lifecycle.nextBillingAt !== undefined && lifecycle.nextBillingAt <= now) {
    return { kind: "EvaluationDue" };
  }
  return null;
}

/** Whether a warning scheduled for `stint` should still go out: the org is in the same stint. */
export function isWarningCurrent(stint: Stint, current: Lifecycle | null): boolean {
  return current !== null && current.state === stint.state && current.stateSince === stint.stateSince;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

type Timers = Pick<Lifecycle, (typeof TIMER_FIELDS)[number]>;

const NO_TIMERS: Timers = {
  nextBillingAt: undefined,
  graceEndsAt: undefined,
  nextRetryAt: undefined,
  exemptUntil: undefined,
  spinDownAt: undefined,
};

interface Entry {
  state: SubscriptionState;
  reason?: LifecycleReason;
  timers: Timers;
  plan?: PlanTier;
  trialStartedAt?: number;
  warnings?: Array<{ template: WarningTemplate; at: number }>;
  effects?: LifecycleEffect[];
}

type Handler = (current: Lifecycle | null, event: LifecycleEvent, ctx: TransitionContext) => Entry;

function warningsBefore(template: WarningTemplate, deadline: number, daysBefore: readonly number[], now: number) {
  return daysBefore.map((days) => ({ template, at: deadline - days * DAY_MS })).filter((w) => w.at > now);
}

function warningsAfter(template: WarningTemplate, start: number, daysAfter: readonly number[]) {
  return daysAfter.map((days) => ({ template, at: start + days * DAY_MS }));
}

function enterActive(currentPeriodEnd: number): Entry {
  return { state: "active", timers: { ...NO_TIMERS, nextBillingAt: currentPeriodEnd } };
}

function enterPastDue(reason: LifecycleReason, ctx: TransitionContext): Entry {
  const graceEndsAt = ctx.now + BILLING_LIFECYCLE.pastDueGraceDays * DAY_MS;
  const template = reason === "payment_failed" ? "billing-payment-failed" : "billing-payment-needed";
  return {
    state: "past_due",
    reason,
    timers: { ...NO_TIMERS, graceEndsAt, nextRetryAt: nextRetryAt(ctx.now, graceEndsAt, ctx.now) },
    warnings: warningsAfter(template, ctx.now, BILLING_LIFECYCLE.warningOffsetsDays.pastDue),
  };
}

function enterSuspended(reason: LifecycleReason, ctx: TransitionContext): Entry {
  const [suspended, stopping] = BILLING_LIFECYCLE.warningOffsetsDays.beforeSpinDown;
  return {
    state: "suspended",
    reason,
    timers: { ...NO_TIMERS, spinDownAt: ctx.now + BILLING_LIFECYCLE.spinDownGraceDays * DAY_MS },
    warnings: [
      ...warningsAfter("billing-suspended", ctx.now, [suspended]),
      ...warningsAfter("billing-engines-stopping", ctx.now, [stopping]),
    ],
  };
}

/** Out of the trial, an exemption or a retry: active when paid up, otherwise past_due with the reason. */
function evaluate(ctx: TransitionContext): Entry {
  const evaluation = evaluateBilling(ctx.provider);
  return evaluation.ok ? enterActive(evaluation.currentPeriodEnd) : enterPastDue(evaluation.reason, ctx);
}

/**
 * Leaving `suspended` for a usable state. A suspended org with no spin-down
 * pending has had its managed engines stopped, so they are started again;
 * before spin-down nothing was stopped and nothing is called.
 */
function reactivate(current: Lifecycle | null, entry: Entry, ctx: TransitionContext): Entry {
  const enginesStopped = current?.state === "suspended" && current.spinDownAt === undefined;
  return {
    ...entry,
    warnings: [...(entry.warnings ?? []), { template: "billing-reactivated", at: ctx.now }],
    effects: [...(entry.effects ?? []), ...(enginesStopped ? [{ kind: "resumeEngines" as const }] : [])],
  };
}

/** Active on the plan the provider bills, until its period end. */
function providerActive(event: LifecycleEvent): Entry {
  if (event.kind !== "ProviderActivated" && event.kind !== "PaymentSucceeded") {
    throw new Error(`providerActive: ${event.kind} carries no provider subscription`);
  }
  return { ...enterActive(event.currentPeriodEnd), plan: event.plan };
}

const startTrial: Handler = (_current, event, ctx) => {
  if (event.kind !== "TrialStarted") {
    throw new Error(`startTrial: got ${event.kind}`);
  }
  const nextBillingAt = ctx.now + event.billingDelayDays * DAY_MS;
  return {
    state: "trialing",
    plan: "starter",
    trialStartedAt: ctx.now,
    timers: { ...NO_TIMERS, nextBillingAt },
    warnings: warningsBefore(
      "billing-trial-ending",
      nextBillingAt,
      BILLING_LIFECYCLE.warningOffsetsDays.beforeBilling,
      ctx.now
    ),
  };
};

const activate: Handler = (_current, event) => providerActive(event);
const reactivateActive: Handler = (current, event, ctx) => reactivate(current, providerActive(event), ctx);
const paymentFailed: Handler = (_current, _event, ctx) => enterPastDue("payment_failed", ctx);
const evaluateNow: Handler = (_current, _event, ctx) => evaluate(ctx);

const providerEnded: Handler = (_current, event, ctx) => {
  if (event.kind !== "ProviderEnded") {
    throw new Error(`providerEnded: got ${event.kind}`);
  }
  return enterSuspended(event.reason, ctx);
};

const graceExpired: Handler = (current, _event, ctx) => {
  if (current?.stateReason === undefined) {
    throw new Error("graceExpired: a past_due subscription has no reason");
  }
  return enterSuspended(current.stateReason, ctx);
};

const operatorSuspended: Handler = (_current, _event, ctx) => enterSuspended("operator", ctx);

const retry: Handler = (current, _event, ctx) => {
  const evaluation = evaluateBilling(ctx.provider);
  if (evaluation.ok) {
    return reactivate(current, enterActive(evaluation.currentPeriodEnd), ctx);
  }
  if (current === null || current.graceEndsAt === undefined) {
    throw new Error("retry: a past_due subscription has no grace end");
  }
  // Same stint: the cadence of warnings scheduled on entry carries on.
  return {
    state: "past_due",
    reason: current.stateReason,
    timers: {
      ...NO_TIMERS,
      graceEndsAt: current.graceEndsAt,
      nextRetryAt: nextRetryAt(current.stateSince, current.graceEndsAt, ctx.now),
    },
  };
};

/**
 * An active period end passed with no renewal webhook. Renewals arrive by
 * webhook, so this asks the provider once before anything is deactivated:
 * the org stays active with no billing timer while the check is out, and the
 * check applies whatever the provider says (billing.confirmRenewal).
 */
const confirmRenewal: Handler = () => ({
  state: "active",
  timers: NO_TIMERS,
  effects: [{ kind: "confirmRenewal" }],
});

const spinDown: Handler = (current, _event, ctx) => ({
  state: "suspended",
  reason: current?.stateReason,
  timers: NO_TIMERS,
  warnings: [{ template: "billing-engines-stopped", at: ctx.now }],
  effects: [{ kind: "stopEngines" }],
});

const grantExemption: Handler = (current, event, ctx) => {
  if (event.kind !== "ExemptionGranted") {
    throw new Error(`grantExemption: got ${event.kind}`);
  }
  const entry: Entry = {
    state: "exempt",
    plan: event.plan,
    timers: { ...NO_TIMERS, exemptUntil: event.until ?? undefined },
  };
  return current?.state === "suspended" ? reactivate(current, entry, ctx) : entry;
};

/**
 * Every legal (state, event) pair. A pair that is missing is an illegal
 * transition: a stale or out-of-order event, recorded and never thrown.
 * `none` is an org with no subscription row yet.
 */
export const TRANSITIONS: Record<SubscriptionState | "none", Partial<Record<LifecycleEventKind, Handler>>> = {
  none: {
    TrialStarted: startTrial,
    ProviderActivated: activate,
    ExemptionGranted: grantExemption,
  },
  trialing: {
    ProviderActivated: activate,
    EvaluationDue: evaluateNow,
    PaymentFailed: paymentFailed,
    ExemptionGranted: grantExemption,
    OperatorSuspended: operatorSuspended,
  },
  active: {
    PaymentSucceeded: activate,
    EvaluationDue: confirmRenewal,
    PaymentFailed: paymentFailed,
    ProviderEnded: providerEnded,
    ExemptionGranted: grantExemption,
    OperatorSuspended: operatorSuspended,
  },
  past_due: {
    RetryDue: retry,
    PaymentSucceeded: reactivateActive,
    ProviderActivated: reactivateActive,
    GraceExpired: graceExpired,
    ProviderEnded: providerEnded,
    ExemptionGranted: grantExemption,
    OperatorSuspended: operatorSuspended,
  },
  suspended: {
    ProviderActivated: reactivateActive,
    PaymentSucceeded: reactivateActive,
    SpinDownDue: spinDown,
    ExemptionGranted: grantExemption,
  },
  exempt: {
    ExemptionExpired: evaluateNow,
    ExemptionRevoked: evaluateNow,
  },
};

/** The write-time invariants of a `subscriptions` row. Throws on the first one broken. */
export function assertLifecycle(lifecycle: Lifecycle): void {
  const fail = (message: string) => {
    throw new Error(`subscription invariant: ${message} (state ${lifecycle.state})`);
  };
  if (lifecycle.state === "trialing" && (lifecycle.plan !== "starter" || lifecycle.nextBillingAt === undefined)) {
    fail("trialing needs plan starter and nextBillingAt");
  }
  if (lifecycle.state === "past_due" && (lifecycle.graceEndsAt === undefined || lifecycle.stateReason === undefined)) {
    fail("past_due needs graceEndsAt and stateReason");
  }
  if (lifecycle.state === "suspended" && lifecycle.stateReason === undefined) {
    fail("suspended needs stateReason");
  }
  if (lifecycle.nextCheckAt !== nextCheckAt(lifecycle)) {
    fail("nextCheckAt is not the earliest timer");
  }
}

/**
 * Applies `event` to the org's lifecycle (`current`, null when it has no
 * subscription row). Pure: the caller writes `next` and schedules `effects`.
 * Staying in a state keeps its `stateSince`, so its pending warnings stay current.
 */
export function transition(current: Lifecycle | null, event: LifecycleEvent, ctx: TransitionContext): TransitionResult {
  const from = current?.state ?? "none";
  const handler = TRANSITIONS[from][event.kind];
  if (handler === undefined) {
    return { ok: false, error: { code: "illegal_transition", from, event: event.kind } };
  }
  const entry = handler(current, event, ctx);
  const plan = entry.plan ?? current?.plan;
  if (plan === undefined) {
    throw new Error(`transition: ${event.kind} from ${from} leaves no plan`);
  }
  const stateSince = current !== null && current.state === entry.state ? current.stateSince : ctx.now;
  const stint: Stint = { state: entry.state, stateSince };
  const withoutCheck = {
    state: entry.state,
    plan,
    stateReason: entry.state === "past_due" || entry.state === "suspended" ? entry.reason : undefined,
    stateSince,
    trialStartedAt: entry.trialStartedAt ?? current?.trialStartedAt,
    ...entry.timers,
  };
  const next: Lifecycle = { ...withoutCheck, nextCheckAt: nextCheckAt(withoutCheck) };
  assertLifecycle(next);
  const warnings: LifecycleEffect[] = (entry.warnings ?? []).map((warning) => ({
    kind: "notifyOwner",
    template: warning.template,
    at: warning.at,
    stint,
  }));
  return { ok: true, next, reason: next.stateReason, effects: [...warnings, ...(entry.effects ?? [])] };
}
