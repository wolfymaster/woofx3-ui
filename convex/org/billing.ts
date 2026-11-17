import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { type EntitlementOverrides, isUsable, type SubscriptionSummary } from "../lib/entitlements";
import type { LifecycleReason } from "../lib/organization";
import type { ProjectedDiscount } from "../lib/orgBilling";
import type { EngineAction } from "./policy";

// The management plane owns billing; Convex keeps the last projection it was
// pushed (`orgBilling`) and enforces from it. This module is the one reader of
// that row and translates it once, in `toOrgBilling`, so the plane's words
// (tier, standing, periodEnd) stay here. Nothing here calls the plane, so the
// gates keep working while it is down.
//
// A suspended org is refused, on its managed engines:
// - engine actions: operating the engine and proxying calls to it
//   (`requireInstanceRole*`, the engine credential reads, and the engine
//   actions in ENGINE_ACTIONS_REFUSED_WHILE_SUSPENDED)
// - module installs, which run through the engine
// - invitations and engine membership changes
// - engine builds, retries and upgrades
// It is still allowed: viewing billing, paying (checkout, the provider
// portal, payment method changes), the owner deleting an engine, removing
// someone from the org, signing in, and the reads the account and billing
// pages render from. Self-hosted engines are never billed, so never refused,
// and an org with no projection yet is not suspended.

/** The org's billing as the app reads it. */
export interface OrgBilling {
  summary: SubscriptionSummary;
  addOns: readonly string[];
  spinDownAt: number | null;
  /** A provider subscription exists, so plan changes go through the provider's portal. */
  hasProviderSubscription: boolean;
  discount: ProjectedDiscount | null;
  overrides: EntitlementOverrides;
}

/** The org's stored projection row, for the ops route that writes it and the tests that read it back. */
export async function orgBillingRow(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"orgBilling"> | null> {
  return ctx.db
    .query("orgBilling")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
}

/**
 * A projection with no tier keeps its standing, reason and dates, so a
 * suspended one still locks the dashboard and a trialing one still prompts.
 * `plan` is null: usability follows the standing alone, but no plan or add-on
 * feature is granted and the org gets no seat limit unless it has a managed
 * engine (see orgSeatLimit).
 */
export function toOrgBilling(row: Doc<"orgBilling">): OrgBilling {
  return {
    summary: {
      plan: row.tier,
      interval: row.interval,
      state: row.standing,
      stateReason: row.reason,
      nextBillingAt: row.standing === "trialing" ? row.trialEndsAt : row.periodEnd,
      graceEndsAt: row.graceEndsAt,
      exemptUntil: row.exemptUntil,
    },
    addOns: row.addOns,
    spinDownAt: row.spinDownAt,
    hasProviderSubscription: row.hasProviderSubscription,
    discount: row.discount,
    overrides: row.overrides,
  };
}

/**
 * The org's billing once the plane has pushed a projection, which is then
 * authoritative. Null for an org it has not reported on yet, which behaves as
 * an org with no subscription did before billing existed: nothing is refused,
 * and its entitlements are the code defaults with no plan.
 */
export async function billingFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<OrgBilling | null> {
  const row = await orgBillingRow(ctx, accountId);
  return row === null ? null : toOrgBilling(row);
}

/** Whether billing locks the org out; no projection never does. */
export function isSuspended(billing: OrgBilling | null): billing is OrgBilling {
  return billing !== null && !isUsable(billing.summary);
}

export type SuspendedRefusal = { code: "org_suspended"; reason: LifecycleReason | null; message: string };

/** Engine actions a suspended org may not take on its managed engines; the rest are reads or org actions. */
export const ENGINE_ACTIONS_REFUSED_WHILE_SUSPENDED: ReadonlySet<EngineAction> = new Set([
  "operateEngine",
  "manageEngineMembers",
]);

function refuseSuspended(billing: OrgBilling): never {
  throw new ConvexError<SuspendedRefusal>({
    code: "org_suspended",
    reason: billing.summary.stateReason,
    message: "This organization's subscription isn't active. The owner can reactivate it in Billing.",
  });
}

/** Throws `org_suspended` while the org is suspended. An org with no projection passes. */
export async function assertNotSuspended(ctx: QueryCtx, accountId: Id<"accounts">): Promise<void> {
  const billing = await billingFor(ctx, accountId);
  if (isSuspended(billing)) {
    refuseSuspended(billing);
  }
}

/**
 * The org's billing when `instance` is a managed engine of a suspended org,
 * else null. The dashboard lock (`access.entry`) and `requireEngineUsable`
 * both decide by it, so the page and the gate never disagree.
 */
export async function suspensionOf(ctx: QueryCtx, instance: Doc<"instances">): Promise<OrgBilling | null> {
  if (instance.hosting !== "managed") {
    return null;
  }
  const billing = await billingFor(ctx, instance.accountId);
  return isSuspended(billing) ? billing : null;
}

/** Throws `org_suspended` for a managed engine of a suspended org. A missing engine passes: the caller's own lookup reports it. */
export async function requireEngineUsable(ctx: QueryCtx, instanceId: Id<"instances">): Promise<void> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    return;
  }
  const suspension = await suspensionOf(ctx, instance);
  if (suspension !== null) {
    refuseSuspended(suspension);
  }
}
