import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
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
import { engineAvailability } from "./lib/entitlementAccess";
import { ADD_ONS } from "./lib/entitlements";
import { MaintenanceApiError, sendTransactionalEmail } from "./lib/maintenanceClient";
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
  type PaymentError,
  type PaymentProvider,
  providerSubscriptionValidator,
} from "./lib/payments/provider";
import { lifecycleEventFor, providerViewFor } from "./lib/payments/providerEvents";
import { paymentProvider } from "./lib/payments/registry";
import { applyTransition, lifecycleOf, subscriptionFor } from "./lib/subscriptions";
import { getInstanceMembership } from "./lib/teamAccess";
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
    try {
      await sendTransactionalEmail(
        {
          template: args.template,
          to: args.to,
          variables: { ...args.variables, billingUrl: `${orgPortalUrl()}/billing` },
        },
        args.idempotencyKey
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = args.attempt + 1;
      if (isPermanent(error) || next >= WARNING_EMAIL_RETRY.maxAttempts) {
        logger.error("billing warning email: giving up", { ...args, variables: undefined, error: message });
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
 * or null when there is nothing to check: the org left active, or a renewal
 * set its next billing date again.
 */
export const renewalCheckTarget = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | null> => {
    const row = await subscriptionFor(ctx, accountId);
    if (row?.state !== "active" || row.nextBillingAt !== undefined) {
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
export async function checkRenewal(deps: RenewalCheckDeps, accountId: Id<"accounts">): Promise<"settled" | "retry"> {
  const subscriptionRef = await deps.runQuery(internal.billing.renewalCheckTarget, { accountId });
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
  return (await deps.runQuery(internal.billing.renewalCheckTarget, { accountId })) === null ? "settled" : "retry";
}

export const confirmRenewal = internalAction({
  args: { accountId: v.id("accounts"), attempt: v.number() },
  handler: async (ctx, { accountId, attempt }): Promise<void> => {
    let outcome: "settled" | "retry";
    try {
      outcome = await checkRenewal(
        {
          provider: paymentProvider(paymentsConfig()),
          runQuery: ctx.runQuery,
          runMutation: ctx.runMutation,
          now: Date.now,
        },
        accountId
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
 * One checkout attempt per org at a time: every request in the same window
 * shares an idempotency key, so the provider hands concurrent and repeated
 * requests the one session the first opened. The session's expiry is derived
 * from the window too, because a replay must repeat every parameter.
 */
export const CHECKOUT_ATTEMPT = {
  windowMs: 30 * 60_000,
  // Keeps the expiry clear of Stripe's 30-minute minimum, which it measures from session creation.
  expiryMarginMs: 5 * 60_000,
} as const;

/** The key and expiry of the org's checkout attempt at `nowMs`; the expiry lands 35-65 minutes out. */
export function checkoutAttempt(
  accountId: Id<"accounts">,
  nowMs: number
): { idempotencyKey: string; expiresAt: number } {
  const windowStart = Math.floor(nowMs / CHECKOUT_ATTEMPT.windowMs) * CHECKOUT_ATTEMPT.windowMs;
  return {
    idempotencyKey: `checkout:${accountId}:${windowStart}`,
    expiresAt: windowStart + 2 * CHECKOUT_ATTEMPT.windowMs + CHECKOUT_ATTEMPT.expiryMarginMs,
  };
}

export interface CheckoutArgs {
  accountId: Id<"accounts">;
  plan: PlanTier;
  interval: BillingInterval;
  promotionCode?: string;
}

/** Opens (or replays) the org's subscription checkout with the provider. */
export async function openSubscriptionCheckout(
  provider: PaymentProvider,
  portalUrl: string,
  customerRef: string | null,
  { accountId, plan, interval, promotionCode }: CheckoutArgs,
  nowMs: number
): Promise<{ url: string }> {
  const result = await provider.createCheckout({
    purpose: { kind: "subscription", accountId, plan, interval, promotionCode: promotionCode?.trim() || null },
    customerRef,
    allowPromotionCodes: true,
    successUrl: `${portalUrl}/billing?checkout=done`,
    cancelUrl: `${portalUrl}/billing`,
    ...checkoutAttempt(accountId, nowMs),
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
  return result.value;
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
    return openSubscriptionCheckout(provider, portalUrl, context.customerRef, args, Date.now());
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
