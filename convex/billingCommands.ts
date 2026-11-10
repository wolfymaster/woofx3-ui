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

/** What the portal shows for refusals it branches on; the plane's own wording is used for the rest. */
const REFUSAL_MESSAGES: Partial<Record<BillingError["code"], string>> = {
  already_subscribed: "This organization already has a subscription. Change it in Manage billing.",
  subscription_exists: "Your payment method needs attention. Update it in the billing portal.",
  suspended_by_operator: "Your organization's account is suspended. Contact woofx3 support.",
  checkout_in_progress: "A checkout for this organization is already open. Finish it, or start again in half an hour.",
  no_customer: "Choose a plan first; there is nothing to manage yet.",
};

const NOT_CONFIGURED: BillingError = {
  code: "not_configured",
  message: "Billing is not configured on this deployment.",
};

/** The error the portal receives: `{ code, message }`, where `code` is what it branches on. */
export function billingConvexError(error: BillingError): ConvexError<BillingError> {
  return new ConvexError<BillingError>({ code: error.code, message: REFUSAL_MESSAGES[error.code] ?? error.message });
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
    return unwrap(await client.startCheckout({ ...terms, idempotencyKey: checkoutIdempotencyKey(terms, Date.now()) }));
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
 * Asks the plane to start the org's trial. Best effort: a failure is logged
 * and never blocks what created the org, because the plane's reconciler
 * ensures every org it can list.
 */
export async function ensureOrgBilling(client: BillingClient, accountId: Id<"accounts">): Promise<void> {
  const result = await client.ensure(accountId);
  if (!result.ok) {
    logger.warn("billing ensure failed; the plane's reconciler will retry", { accountId, error: result.error });
  }
}

export const ensureBilling = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (_ctx, { accountId }): Promise<void> => {
    const client = billingClientFromEnv();
    if (client !== null) {
      await ensureOrgBilling(client, accountId);
    }
  },
});
