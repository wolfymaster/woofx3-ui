import { describe, expect, test } from "bun:test";
import {
  assertLifecycle,
  BILLING_LIFECYCLE,
  dueEvent,
  EVENT_KINDS,
  isWarningCurrent,
  type Lifecycle,
  type LifecycleEvent,
  type LifecycleEventKind,
  nextRetryAt,
  type ProviderView,
  transition,
} from "./billingLifecycle";
import type { SubscriptionState } from "./organization";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 1);
const GOOD: ProviderView = { standing: "good", endedReason: null, currentPeriodEnd: T0 + 60 * DAY };

/** A fake clock: every step is an explicit time. */
function apply(current: Lifecycle | null, event: LifecycleEvent, now: number, provider: ProviderView = null) {
  const result = transition(current, event, { now, provider });
  if (!result.ok) {
    throw new Error(`fixture transition ${event.kind} from ${current?.state ?? "none"} is illegal`);
  }
  return result;
}

const EVENTS: Record<LifecycleEventKind, LifecycleEvent> = {
  TrialStarted: { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.trialDays },
  EvaluationDue: { kind: "EvaluationDue" },
  RetryDue: { kind: "RetryDue" },
  GraceExpired: { kind: "GraceExpired" },
  SpinDownDue: { kind: "SpinDownDue" },
  ExemptionExpired: { kind: "ExemptionExpired" },
  ProviderActivated: { kind: "ProviderActivated", plan: "starter", currentPeriodEnd: T0 + 60 * DAY },
  PaymentSucceeded: { kind: "PaymentSucceeded", plan: "starter", currentPeriodEnd: T0 + 60 * DAY },
  PaymentFailed: { kind: "PaymentFailed" },
  ProviderEnded: { kind: "ProviderEnded", reason: "subscription_canceled" },
  ExemptionGranted: { kind: "ExemptionGranted", plan: "pro", until: null },
  ExemptionRevoked: { kind: "ExemptionRevoked" },
  OperatorSuspended: { kind: "OperatorSuspended" },
};

/** One reachable lifecycle per state, built through the machine itself. */
function inState(state: SubscriptionState | "none"): Lifecycle | null {
  const trial = apply(null, EVENTS.TrialStarted, T0).next;
  switch (state) {
    case "none":
      return null;
    case "trialing":
      return trial;
    case "active":
      return apply(trial, EVENTS.ProviderActivated, T0 + DAY).next;
    case "past_due":
      return apply(trial, EVENTS.EvaluationDue, T0 + 30 * DAY).next;
    case "suspended":
      return apply(inState("past_due"), EVENTS.GraceExpired, T0 + 44 * DAY).next;
    case "exempt":
      return apply(trial, EVENTS.ExemptionGranted, T0 + DAY).next;
  }
}

type Expected = SubscriptionState | null;
const EXPECTED: Record<SubscriptionState | "none", Partial<Record<LifecycleEventKind, Expected>>> = {
  none: { TrialStarted: "trialing", ProviderActivated: "active", ExemptionGranted: "exempt" },
  trialing: {
    ProviderActivated: "active",
    EvaluationDue: "past_due",
    PaymentFailed: "past_due",
    ExemptionGranted: "exempt",
    OperatorSuspended: "suspended",
  },
  active: {
    PaymentSucceeded: "active",
    EvaluationDue: "active",
    RetryDue: "active",
    PaymentFailed: "past_due",
    ProviderEnded: "suspended",
    ExemptionGranted: "exempt",
    OperatorSuspended: "suspended",
  },
  past_due: {
    RetryDue: "past_due",
    PaymentSucceeded: "active",
    ProviderActivated: "active",
    GraceExpired: "suspended",
    ProviderEnded: "suspended",
    ExemptionGranted: "exempt",
    OperatorSuspended: "suspended",
  },
  suspended: {
    ProviderActivated: "active",
    PaymentSucceeded: "active",
    SpinDownDue: "suspended",
    RetryDue: "suspended",
    ExemptionGranted: "exempt",
  },
  exempt: { ExemptionExpired: "past_due", ExemptionRevoked: "past_due", ExemptionGranted: "exempt" },
};

describe("every (state, event) pair", () => {
  for (const from of Object.keys(EXPECTED) as Array<SubscriptionState | "none">) {
    for (const kind of EVENT_KINDS) {
      const expected = EXPECTED[from][kind] ?? null;
      test(`${from} + ${kind} -> ${expected ?? "illegal"}`, () => {
        const current = inState(from);
        const now = (current?.stateSince ?? T0) + HOUR;
        const result = transition(current, EVENTS[kind], { now, provider: null });
        if (expected === null) {
          expect(result).toEqual({ ok: false, error: { code: "illegal_transition", from, event: kind } });
        } else {
          expect(result.ok && result.next.state).toBe(expected);
        }
      });
    }
  }
});

describe("trial", () => {
  test("starts on Starter with billing after trialDays and warnings before it", () => {
    const { next, effects } = apply(null, EVENTS.TrialStarted, T0);
    expect(next).toMatchObject({ state: "trialing", plan: "starter", trialStartedAt: T0 });
    expect(next.nextBillingAt).toBe(T0 + 30 * DAY);
    expect(next.nextCheckAt).toBe(next.nextBillingAt);
    expect(effects.map((e) => e.kind === "notifyOwner" && [e.template, (e.at - T0) / DAY])).toEqual([
      ["billing-trial-ending", 23],
      ["billing-trial-ending", 27],
      ["billing-trial-ending", 29],
    ]);
  });

  test("a migration trial bills after migrationBillingDelayDays", () => {
    const { next } = apply(
      null,
      { kind: "TrialStarted", billingDelayDays: BILLING_LIFECYCLE.migrationBillingDelayDays },
      T0
    );
    expect(next.nextBillingAt).toBe(T0 + BILLING_LIFECYCLE.migrationBillingDelayDays * DAY);
  });

  test("ends active when the provider subscription is good", () => {
    const trial = inState("trialing");
    const { next } = apply(trial, EVENTS.EvaluationDue, T0 + 30 * DAY, GOOD);
    expect(next).toMatchObject({ state: "active", nextBillingAt: GOOD?.currentPeriodEnd });
  });

  test("ends past_due with no_payment_method and the grace and retry timers", () => {
    const at = T0 + 30 * DAY;
    const { next, effects } = apply(inState("trialing"), EVENTS.EvaluationDue, at);
    expect(next).toMatchObject({
      state: "past_due",
      stateReason: "no_payment_method",
      graceEndsAt: at + 14 * DAY,
      nextRetryAt: at + 24 * HOUR,
      nextBillingAt: undefined,
    });
    expect(next.nextCheckAt).toBe(at + 24 * HOUR);
    expect(effects.map((e) => e.kind === "notifyOwner" && [e.template, (e.at - at) / DAY])).toEqual([
      ["billing-payment-needed", 0],
      ["billing-payment-needed", 3],
      ["billing-payment-needed", 7],
      ["billing-payment-needed", 12],
    ]);
  });
});

describe("past_due retries", () => {
  test("follow the offsets, keep the stint and stop before grace ends", () => {
    let current = inState("past_due");
    if (current === null) {
      throw new Error("fixture");
    }
    const since = current.stateSince;
    const seen: Array<number | undefined> = [];
    for (let i = 0; i < 4 && current.nextRetryAt !== undefined; i++) {
      const at = current.nextRetryAt;
      current = apply(current, EVENTS.RetryDue, at).next;
      expect(current.state).toBe("past_due");
      expect(current.stateSince).toBe(since);
      seen.push(current.nextRetryAt === undefined ? undefined : (current.nextRetryAt - since) / HOUR);
    }
    expect(seen).toEqual([72, 168, undefined]);
    expect(current.nextCheckAt).toBe(current.graceEndsAt);
  });

  test("the last gap repeats until grace ends", () => {
    const longGrace = 1000 * HOUR;
    expect(nextRetryAt(0, longGrace, 200 * HOUR)).toBe(336 * HOUR);
    expect(nextRetryAt(0, longGrace, 336 * HOUR)).toBe(504 * HOUR);
    expect(nextRetryAt(0, 400 * HOUR, 336 * HOUR)).toBeUndefined();
  });

  test("a successful retry reactivates and says so", () => {
    const current = inState("past_due");
    const at = (current?.nextRetryAt ?? 0) + 1;
    const { next, effects } = apply(current, EVENTS.RetryDue, at, GOOD);
    expect(next.state).toBe("active");
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: "notifyOwner", template: "billing-reactivated", at })
    );
  });

  test("grace expiry suspends with the past_due reason and a spin-down", () => {
    const current = inState("past_due");
    const at = current?.graceEndsAt ?? 0;
    const { next } = apply(current, EVENTS.GraceExpired, at);
    expect(next).toMatchObject({ state: "suspended", stateReason: "no_payment_method", spinDownAt: at + 7 * DAY });
  });
});

describe("warnings", () => {
  test("a warning is current only in the stint that scheduled it", () => {
    const trial = inState("trialing");
    if (trial === null) {
      throw new Error("fixture");
    }
    const stint = { state: trial.state, stateSince: trial.stateSince };
    expect(isWarningCurrent(stint, trial)).toBe(true);
    const active = apply(trial, EVENTS.ProviderActivated, T0 + DAY).next;
    expect(isWarningCurrent(stint, active)).toBe(false);
    expect(isWarningCurrent(stint, null)).toBe(false);
  });

  test("staying past_due after a failed retry keeps the entry's warnings current", () => {
    const pastDue = inState("past_due");
    if (pastDue === null) {
      throw new Error("fixture");
    }
    const stint = { state: pastDue.state, stateSince: pastDue.stateSince };
    const after = apply(pastDue, EVENTS.RetryDue, pastDue.nextRetryAt ?? 0).next;
    expect(isWarningCurrent(stint, after)).toBe(true);
  });
});

describe("spin-down and reactivation", () => {
  test("SpinDownDue stops managed engines, with a recheck that issues the stop again", () => {
    const suspended = inState("suspended");
    const at = suspended?.spinDownAt ?? 0;
    const recheckAt = at + BILLING_LIFECYCLE.effectRecheckHours * HOUR;
    const { next, effects } = apply(suspended, EVENTS.SpinDownDue, at);
    expect(effects).toContainEqual({ kind: "stopEngines" });
    expect(next).toMatchObject({ state: "suspended", spinDownAt: undefined, nextCheckAt: recheckAt });
    expect(dueEvent(next, recheckAt)).toEqual({ kind: "RetryDue" });
    const again = apply(next, EVENTS.RetryDue, recheckAt);
    expect(again.effects).toEqual([{ kind: "stopEngines" }]);
    expect(again.next).toMatchObject({
      state: "suspended",
      stateSince: next.stateSince,
      stateReason: next.stateReason,
      nextCheckAt: recheckAt + BILLING_LIFECYCLE.effectRecheckHours * HOUR,
    });
  });

  test("reactivating before spin-down resumes nothing", () => {
    const suspended = inState("suspended");
    const { next, effects } = apply(suspended, EVENTS.PaymentSucceeded, (suspended?.stateSince ?? 0) + DAY);
    expect(next.state).toBe("active");
    expect(effects.some((e) => e.kind === "resumeEngines")).toBe(false);
  });

  test("reactivating after spin-down resumes the engines", () => {
    const suspended = inState("suspended");
    const stopped = apply(suspended, EVENTS.SpinDownDue, suspended?.spinDownAt ?? 0).next;
    const { effects } = apply(stopped, EVENTS.PaymentSucceeded, (suspended?.spinDownAt ?? 0) + DAY);
    expect(effects).toContainEqual({ kind: "resumeEngines" });
  });

  test("an exemption for a stopped org resumes its engines too", () => {
    const suspended = inState("suspended");
    const stopped = apply(suspended, EVENTS.SpinDownDue, suspended?.spinDownAt ?? 0).next;
    const { next, effects } = apply(stopped, EVENTS.ExemptionGranted, (suspended?.spinDownAt ?? 0) + DAY);
    expect(next).toMatchObject({ state: "exempt", plan: "pro", nextCheckAt: undefined });
    expect(effects).toContainEqual({ kind: "resumeEngines" });
  });
});

describe("active", () => {
  test("a payment moves the next billing date to the new period end", () => {
    const { next } = apply(
      inState("active"),
      { kind: "PaymentSucceeded", plan: "pro", currentPeriodEnd: T0 + 90 * DAY },
      T0 + 2 * DAY
    );
    expect(next).toMatchObject({ plan: "pro", nextBillingAt: T0 + 90 * DAY });
  });

  test("a period end passed without a renewal asks the provider, and stays active with a recheck", () => {
    const at = T0 + 100 * DAY;
    const recheckAt = at + BILLING_LIFECYCLE.effectRecheckHours * HOUR;
    const stale: ProviderView = { standing: "good", endedReason: null, currentPeriodEnd: at - DAY };
    const { next, effects } = apply(inState("active"), EVENTS.EvaluationDue, at, stale);
    expect(next).toMatchObject({ state: "active", nextBillingAt: undefined, nextCheckAt: recheckAt });
    expect(effects).toEqual([{ kind: "confirmRenewal" }]);
    const again = apply(next, EVENTS.RetryDue, recheckAt, stale);
    expect(again.effects).toEqual([{ kind: "confirmRenewal" }]);
    expect(again.next).toMatchObject({ state: "active", nextBillingAt: undefined });
  });
});

describe("dueEvent", () => {
  test("spin-down wins over every other due timer", () => {
    const base = inState("trialing");
    if (base === null) {
      throw new Error("fixture");
    }
    const all = { ...base, spinDownAt: 1, graceEndsAt: 1, nextRetryAt: 1, exemptUntil: 1, nextBillingAt: 1 };
    expect(dueEvent(all, 2)).toEqual({ kind: "SpinDownDue" });
    expect(dueEvent({ ...all, spinDownAt: undefined }, 2)).toEqual({ kind: "GraceExpired" });
    expect(dueEvent(base, T0)).toBeNull();
  });
});

describe("assertLifecycle", () => {
  test("refuses a past_due row with no grace end and a wrong nextCheckAt", () => {
    const pastDue = inState("past_due");
    if (pastDue === null) {
      throw new Error("fixture");
    }
    expect(() => assertLifecycle({ ...pastDue, graceEndsAt: undefined })).toThrow("past_due needs graceEndsAt");
    expect(() => assertLifecycle({ ...pastDue, nextCheckAt: 0 })).toThrow("nextCheckAt");
    expect(() => assertLifecycle({ ...pastDue, state: "trialing", plan: "pro" })).toThrow("trialing needs");
  });
});
