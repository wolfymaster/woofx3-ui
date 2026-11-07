import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { dueEvent, isWarningCurrent, WARNING_TEMPLATES } from "./lib/billingLifecycle";
import { warningNotification, warningVariables } from "./lib/billingWarnings";
import { ADD_ONS } from "./lib/entitlements";
import { billingIntervalValidator, planTierValidator, subscriptionStateValidator } from "./lib/organization";
import { requireOrgActionFor } from "./lib/orgRoles";
import { paymentsConfig } from "./lib/payments/config";
import {
  type AppliedDiscount,
  type PaymentError,
  type PaymentProvider,
  providerSubscriptionValidator,
} from "./lib/payments/provider";
import { lifecycleEventFor, providerViewFor } from "./lib/payments/providerEvents";
import { paymentProvider } from "./lib/payments/registry";
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

/** A provider checkout for a plan, for an org with no subscription in good standing. Returns its URL. */
export const startCheckout = action({
  args: {
    accountId: v.id("accounts"),
    plan: planTierValidator,
    interval: billingIntervalValidator,
    promotionCode: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, plan, interval, promotionCode }): Promise<{ url: string }> => {
    const context = await requireBillingManager(ctx, accountId);
    if (context.paidUp) {
      throw new ConvexError({
        code: "already_subscribed",
        message: "This organization already has a subscription. Change it in Manage billing.",
      });
    }
    const { provider, portalUrl } = configuredProvider();
    const result = await provider.createCheckout({
      purpose: { kind: "subscription", accountId, plan, interval, promotionCode: promotionCode?.trim() || null },
      customerRef: context.customerRef,
      allowPromotionCodes: true,
      successUrl: `${portalUrl}/billing?checkout=done`,
      cancelUrl: `${portalUrl}/billing`,
      idempotencyKey: `checkout:${accountId}:${crypto.randomUUID()}`,
    });
    if (!result.ok) {
      throw providerFailure(result.error);
    }
    return result.value;
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

// ---------------------------------------------------------------------------
// Provider webhooks
// ---------------------------------------------------------------------------

const outcomeValidator = v.union(v.literal("applied"), v.literal("ignored"), v.literal("failed"));

/**
 * Keeps a webhook as received, before anything is done with it. A delivery
 * already applied or ignored is a duplicate; one that failed is processed again.
 */
export const recordEvent = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    rawPayload: v.string(),
    schemaVersion: v.number(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args): Promise<{ duplicate: boolean }> => {
    const existing = await ctx.db
      .query("billingEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", args.eventId))
      .unique();
    if (existing !== null) {
      return { duplicate: existing.outcome === "applied" || existing.outcome === "ignored" };
    }
    await ctx.db.insert("billingEvents", { provider: "stripe", ...args, outcome: "received" });
    return { duplicate: false };
  },
});

export const finishEvent = internalMutation({
  args: {
    eventId: v.string(),
    outcome: outcomeValidator,
    error: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, { eventId, outcome, error, accountId }) => {
    const row = await ctx.db
      .query("billingEvents")
      .withIndex("by_provider_event", (q) => q.eq("provider", "stripe").eq("eventId", eventId))
      .unique();
    if (row === null) {
      throw new Error(`finishEvent: billing event ${eventId} was never recorded`);
    }
    await ctx.db.patch(row._id, { outcome, error, accountId });
  },
});

/**
 * Applies the provider's truth about a subscription: the lifecycle event its
 * standing means, then the provider mirror on the row. A read no newer than
 * the last one applied is stale and changes nothing. An event the lifecycle
 * has no transition for still updates the mirror, so operators see it.
 */
export const applyProviderSubscription = internalMutation({
  args: { subscription: providerSubscriptionValidator },
  handler: async (
    ctx,
    { subscription: read }
  ): Promise<{ outcome: "applied" | "ignored"; error?: string; accountId?: Id<"accounts"> }> => {
    const accountId = ctx.db.normalizeId("accounts", read.accountId);
    if (accountId === null || (await ctx.db.get(accountId)) === null) {
      return { outcome: "ignored", error: `no org ${read.accountId} for subscription ${read.subscriptionRef}` };
    }
    const subscription = { ...read, accountId };
    const unknownAddOn = subscription.addOns.find((key) => !Object.keys(ADD_ONS).includes(key));
    if (unknownAddOn !== undefined) {
      throw new Error(`Provider subscription ${subscription.subscriptionRef} has unknown add-on ${unknownAddOn}`);
    }
    const before = await subscriptionFor(ctx, subscription.accountId);
    if (before?.providerSyncedAt !== undefined && subscription.observedAt <= before.providerSyncedAt) {
      return { outcome: "ignored", error: "stale: an equal or newer provider read was applied already", accountId };
    }
    // The row follows one provider subscription. Another one replaces it only
    // once it has ended, so a late event about an old, ended subscription
    // can't suspend an org that has subscribed again.
    if (
      before?.providerSubscriptionId !== undefined &&
      before.providerSubscriptionId !== subscription.subscriptionRef &&
      before.providerStanding !== "ended"
    ) {
      return {
        outcome: "ignored",
        error: `subscription ${subscription.subscriptionRef} is not the org's current ${before.providerSubscriptionId}`,
        accountId,
      };
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
  },
});
