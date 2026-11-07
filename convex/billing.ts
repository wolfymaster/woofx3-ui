import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { dueEvent, isWarningCurrent, WARNING_TEMPLATES } from "./lib/billingLifecycle";
import { warningNotification, warningVariables } from "./lib/billingWarnings";
import { subscriptionStateValidator } from "./lib/organization";
import { applyTransition, lifecycleOf, subscriptionFor } from "./lib/subscriptions";
import { logger } from "./logger";
import { sendNotificationOnce } from "./notifications";

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
    return { sent };
  },
});

/** Stops or starts the org's managed engines with its subscription. */
export const runEngineEffect = internalAction({
  args: {
    accountId: v.id("accounts"),
    transitionId: v.id("subscriptionTransitions"),
    effect: v.union(v.literal("stopEngines"), v.literal("resumeEngines")),
  },
  handler: async (_ctx, args) => {
    // TODO: call the maintenance stop and start endpoints for each managed
    // engine; they are added with the engine stop/start contract, later in this stack.
    logger.info("billing engine effect", args);
  },
});
