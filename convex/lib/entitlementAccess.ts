import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LifecycleReason } from "./billingLifecycle";
import {
  type AccountPlanRow,
  addOnFeatures,
  ENTITLEMENT_CATALOG,
  type EntitlementFeatureKey,
  type Entitlements,
  isAssignmentActive,
  isUsable,
  resolveEntitlements,
  type SubscriptionSummary,
} from "./entitlements";
import { type BillingView, billingFor } from "./orgBilling";

/** The plan for accounts without an active assignment, or null when operators have marked none. */
export async function defaultPlan(ctx: QueryCtx): Promise<Doc<"plans"> | null> {
  return ctx.db
    .query("plans")
    .withIndex("by_default", (q) => q.eq("isDefault", true))
    .unique();
}

/** The plan row for a tier. A tier with no row is an operator setup error, so it throws. */
async function tierPlan(ctx: QueryCtx, key: string): Promise<Doc<"plans">> {
  const plan = await ctx.db
    .query("plans")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (plan === null) {
    throw new Error(`No plan row for tier "${key}"; seed it with plans:upsert (docs/patterns/entitlements.md)`);
  }
  return plan;
}

/**
 * The org's entitlements at `nowMs`. With billing (a projection from the
 * management plane, else a subscription), its plan applies in a usable state
 * and none applies while suspended. An org with neither keeps the operator
 * assignment or default plan it had before billing existed. A projection
 * carries its own overrides; on a subscription, operator overrides
 * (`accountPlans`) apply on top.
 */
export async function accountEntitlements(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  nowMs: number
): Promise<Entitlements> {
  const billing = await billingFor(ctx, accountId);
  if (billing !== null) {
    const { summary } = billing;
    const plan = summary.plan !== null && isUsable(summary) ? await tierPlan(ctx, summary.plan) : null;
    return resolveEntitlements(plan, await billingOverrides(ctx, accountId, billing), nowMs, ENTITLEMENT_CATALOG, {
      subscription: summary,
      grantedFeatures: addOnFeatures(summary, billing.addOns),
    });
  }
  const assignment = await accountPlanFor(ctx, accountId);
  let plan: Doc<"plans"> | null;
  if (isAssignmentActive(assignment, nowMs) && assignment.planId !== undefined) {
    plan = await ctx.db.get(assignment.planId);
    if (plan === null) {
      // deletePlan refuses a plan any account is on.
      throw new Error(`Account ${accountId} is on plan ${assignment.planId}, which does not exist`);
    }
  } else {
    plan = await defaultPlan(ctx);
  }
  return resolveEntitlements(plan, assignment, nowMs);
}

async function accountPlanFor(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"accountPlans"> | null> {
  return ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
}

/** The per-account changes layered over the tier's plan, never a plan assignment. */
async function billingOverrides(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  billing: BillingView
): Promise<AccountPlanRow | null> {
  if (billing.overrides !== null) {
    return billing.overrides;
  }
  const assignment = await accountPlanFor(ctx, accountId);
  return assignment === null ? null : { ...assignment, planId: undefined };
}

/**
 * Availability comes before the plan: paid features exist only on hosted
 * (managed) engines. A self-hosted engine needs no subscription, so its org's
 * plan is never read for it.
 */
export type EngineAvailability =
  | { availability: "hosted"; entitlements: Entitlements }
  | { availability: "self_hosted" };

export async function engineAvailability(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  nowMs: number
): Promise<EngineAvailability> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error(`engineAvailability: instance ${instanceId} does not exist`);
  }
  if (instance.hosting !== "managed") {
    return { availability: "self_hosted" };
  }
  return { availability: "hosted", entitlements: await accountEntitlements(ctx, instance.accountId, nowMs) };
}

/** Whether a paid feature is on. Never on a self-hosted engine, whatever its org pays for. */
export function hasFeature(availability: EngineAvailability, feature: EntitlementFeatureKey): boolean {
  return availability.availability === "hosted" && availability.entitlements.features.includes(feature);
}

export type EntitlementRefusal = { code: "subscription_suspended"; reason: LifecycleReason | null; message: string };

/**
 * The org's subscription when it is usable; throws while it is suspended or
 * missing. For managed-engine paths only: self-hosted engines need none.
 */
export async function requireUsableSubscription(
  ctx: QueryCtx,
  accountId: Id<"accounts">
): Promise<SubscriptionSummary> {
  const subscription = (await billingFor(ctx, accountId))?.summary ?? null;
  if (subscription === null || !isUsable(subscription)) {
    throw new ConvexError<EntitlementRefusal>({
      code: "subscription_suspended",
      reason: subscription?.stateReason ?? null,
      message: "This organization's subscription isn't active. The owner can reactivate it in Billing.",
    });
  }
  return subscription;
}

export const SEATS_FULL = "Your plan's seats are all taken. Upgrade or remove someone to invite more people";

/**
 * The org's `org.members` limit (every org member, owner included), or null
 * when no seat limit applies. Seats belong to the org, not to an engine: the
 * limit applies once the org has a plan (subscription or projection tier) or any managed engine,
 * whichever engine a person joins through. An org with only self-hosted
 * engines has none, nor does a plan without one.
 */
export async function orgSeatLimit(ctx: QueryCtx, accountId: Id<"accounts">, nowMs: number): Promise<number | null> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const billing = await billingFor(ctx, accountId);
  const seated =
    (billing !== null && billing.summary.plan !== null) || instances.some((instance) => instance.hosting === "managed");
  if (!seated) {
    return null;
  }
  const limit = (await accountEntitlements(ctx, accountId, nowMs)).limits["org.members"];
  if (limit === undefined) {
    throw new Error('Limit "org.members" was not resolved');
  }
  return limit;
}

/** Whether the org has no seat left for one more person (see orgSeatLimit). */
export async function orgSeatsFull(ctx: QueryCtx, accountId: Id<"accounts">, nowMs: number): Promise<boolean> {
  const limit = await orgSeatLimit(ctx, accountId, nowMs);
  if (limit === null) {
    return false;
  }
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(limit + 1);
  return members.length >= limit;
}
