import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction, internalQuery } from "./_generated/server";
import {
  type AppliedDiscount,
  type BillingClient,
  type BillingError,
  type BillingResult,
  billingClientFromEnv,
  type CheckoutState,
  checkoutIdempotencyKey,
  type Invoice,
} from "./lib/billingClient";
import { billingIntervalValidator, planTierValidator } from "./lib/organization";
import { orgCan, orgRoleOf, requireOrgActionFor } from "./lib/orgRoles";
import { logger } from "./logger";

// The billing commands a person triggers in the org portal. Each checks that
// the caller manages the org's billing, then asks the management plane to do
// the work (convex/lib/billingClient.ts). Never called on a read path.

const GENERIC_MESSAGE =
  "Billing hit a problem. Try again in a moment, or contact woofx3 support if it keeps happening.";
const RETRY_MESSAGE = "Billing is unavailable right now. Try again in a moment.";

/**
 * What the portal shows for each code. The plane's own wording never reaches
 * a person; a code not listed (including any the plane adds later) gets the
 * generic message.
 */
const FRIENDLY_MESSAGES: Partial<Record<BillingError["code"], string>> = {
  already_subscribed: "This organization already has a subscription. Change it in Manage billing.",
  subscription_exists: "Your payment method needs attention. Update it in the billing portal.",
  suspended_by_operator: "Your organization's account is suspended. Contact woofx3 support.",
  checkout_in_progress: "A payment for this organization is being confirmed. Check back in a few minutes.",
  account_not_found: "We could not find this organization's billing account. Contact woofx3 support.",
  checkout_not_found: "We could not find that checkout. Choose a plan to start again.",
  no_customer: "Choose a plan first; there is nothing to manage yet.",
  exempt: "This organization's plan is complimentary, so there is nothing to buy.",
  not_configured: "Billing is not configured on this deployment.",
  unknown_discount: "That promotion code can't be used.",
  promotion_code_not_found: "That promotion code doesn't exist or is no longer active.",
  invalid_return_path: "That page can't be used to return from billing.",
  subscription_not_found: "Your billing is still being set up. Try again in a moment.",
  payment_unavailable: RETRY_MESSAGE,
  payment_refused: "We could not start your payment. Please contact support if this continues.",
  identity_unavailable: RETRY_MESSAGE,
  unreachable: RETRY_MESSAGE,
};

const NOT_CONFIGURED: BillingError = {
  code: "not_configured",
  message: "Billing is not configured on this deployment.",
};

/** The error the portal receives: `{ code, message }`, where `code` is what it branches on. */
export function billingConvexError(error: BillingError): ConvexError<BillingError> {
  return new ConvexError<BillingError>({ code: error.code, message: FRIENDLY_MESSAGES[error.code] ?? GENERIC_MESSAGE });
}

function unwrap<T>(result: BillingResult<T>): T {
  if (!result.ok) {
    throw billingConvexError(result.error);
  }
  return result.value;
}

export const assertBillingManager = internalQuery({
  args: { accountId: v.id("accounts"), userId: v.id("users") },
  handler: async (ctx, { accountId, userId }): Promise<null> => {
    await requireOrgActionFor(ctx, accountId, userId, "manageBilling");
    return null;
  },
});

/** Whether the user manages the org's billing; an id that is not an org of this deployment is no. */
export const mayManageBilling = internalQuery({
  args: { accountId: v.string(), userId: v.id("users") },
  handler: async (ctx, { accountId, userId }): Promise<boolean> => {
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id === null ? null : await ctx.db.get(id);
    return account !== null && orgCan(await orgRoleOf(ctx, account, userId), "manageBilling");
  },
});

async function requireUser(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ code: "not_authenticated", message: "Not authenticated" });
  }
  return userId;
}

async function requireManagerClient(ctx: ActionCtx, accountId: Id<"accounts">): Promise<BillingClient> {
  await ctx.runQuery(internal.billingCommands.assertBillingManager, { accountId, userId: await requireUser(ctx) });
  return requireClient();
}

// stylegate:ignore ANY-LAY-004 reason="A Convex action handler is the composition root: no process outlives one call to inject a shared client from"
function requireClient(): BillingClient {
  const client = billingClientFromEnv();
  if (client === null) {
    throw billingConvexError(NOT_CONFIGURED);
  }
  return client;
}

/** A checkout for a plan. Refusals (already subscribed, failing payment, operator suspension) keep their codes. */
export const startCheckout = action({
  args: {
    accountId: v.id("accounts"),
    plan: planTierValidator,
    interval: billingIntervalValidator,
    promotionCode: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, plan, interval, promotionCode }): Promise<{ url: string; checkoutId: string }> => {
    const client = await requireManagerClient(ctx, accountId);
    const terms = { accountId, tier: plan, interval, promotionCode: promotionCode?.trim() || undefined };
    return unwrap(
      await client.startCheckout({ ...terms, idempotencyKey: await checkoutIdempotencyKey(terms, Date.now()) })
    );
  },
});

/** What a promotion code would take off, before checkout; null when it doesn't exist or is inactive. */
export const previewPromotionCode = action({
  args: { accountId: v.id("accounts"), code: v.string() },
  handler: async (ctx, { accountId, code }): Promise<AppliedDiscount | null> => {
    const client = await requireManagerClient(ctx, accountId);
    const trimmed = code.trim();
    return trimmed === "" ? null : unwrap(await client.lookupPromotionCode(trimmed));
  },
});

export const openPortal = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<{ url: string }> => {
    const client = await requireManagerClient(ctx, accountId);
    return unwrap(await client.openPortal(accountId));
  },
});

/** The org's invoices for its owner; null for anyone else, so the portal hides the page. */
export const invoices = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Invoice[] | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null || !(await ctx.runQuery(internal.billingCommands.mayManageBilling, { accountId, userId }))) {
      return null;
    }
    return unwrap(await requireClient().listInvoices(accountId));
  },
});

/** Where a checkout stands, for the page the customer returns to. Only the org's billing managers may ask. */
export const checkoutState = action({
  args: { checkoutId: v.string() },
  handler: async (ctx, { checkoutId }): Promise<{ state: CheckoutState }> => {
    const userId = await requireUser(ctx);
    const view = unwrap(await requireClient().checkoutState(checkoutId));
    if (!(await ctx.runQuery(internal.billingCommands.mayManageBilling, { accountId: view.accountId, userId }))) {
      throw new ConvexError({ code: "not_authorized", message: "Your organization role doesn't allow this" });
    }
    return { state: view.state };
  },
});

/**
 * `ensure` is idempotent, so every attempt may be repeated. Delays double from
 * `baseDelayMs` up to `maxDelayMs`, each spread by +/- `jitterRatio`; twelve
 * attempts span about a day.
 */
export const ENSURE_RETRY = {
  maxAttempts: 12,
  baseDelayMs: 2 * 60_000,
  maxDelayMs: 4 * 60 * 60_000,
  jitterRatio: 0.2,
} as const;

/** How long to wait after failed attempt number `attempt` (0-based); `random` is in [0, 1). */
export function ensureRetryDelayMs(attempt: number, random: number): number {
  const delay = Math.min(ENSURE_RETRY.baseDelayMs * 2 ** attempt, ENSURE_RETRY.maxDelayMs);
  return Math.round(delay * (1 + ENSURE_RETRY.jitterRatio * (2 * random - 1)));
}

/** Asks the plane to start the org's trial; whether it succeeded. Failures are logged by the caller's retry policy. */
export async function ensureOrgBilling(client: BillingClient, accountId: Id<"accounts">): Promise<boolean> {
  const result = await client.ensure(accountId);
  if (!result.ok) {
    logger.warn("billing ensure failed", { accountId, error: result.error });
  }
  return result.ok;
}

/**
 * Starts the org's trial and never blocks what created the org. A failure is
 * retried here on the Convex scheduler, because the plane's reconciler may be
 * off. After the last attempt the org stays without billing, which hosts it
 * unbilled, so the exhaustion is logged at error level for operators to act on.
 */
export const ensureBilling = internalAction({
  args: { accountId: v.id("accounts"), attempt: v.optional(v.number()) },
  handler: async (ctx, { accountId, attempt = 0 }): Promise<void> => {
    const client = billingClientFromEnv();
    if (client === null || (await ensureOrgBilling(client, accountId))) {
      return;
    }
    if (attempt + 1 >= ENSURE_RETRY.maxAttempts) {
      logger.error("billing ensure gave up; this org has no billing and is hosted unbilled until it is fixed", {
        accountId,
        attempts: attempt + 1,
      });
      return;
    }
    await ctx.scheduler.runAfter(ensureRetryDelayMs(attempt, Math.random()), internal.billingCommands.ensureBilling, {
      accountId,
      attempt: attempt + 1,
    });
  },
});
