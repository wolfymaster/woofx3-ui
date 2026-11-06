import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LifecycleReason } from "./billingLifecycle";
import {
  addOnFeatures,
  ENTITLEMENT_CATALOG,
  ENTITLEMENT_FEATURES,
  type EntitlementFeatureKey,
  type Entitlements,
  isAssignmentActive,
  isUsable,
  resolveEntitlements,
  type SubscriptionSummary,
} from "./entitlements";
import { subscriptionFor } from "./subscriptions";

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

export function subscriptionSummary(row: Doc<"subscriptions"> | null): SubscriptionSummary | null {
  if (row === null) {
    return null;
  }
  return {
    plan: row.plan,
    interval: row.interval ?? null,
    state: row.state,
    stateReason: row.stateReason ?? null,
    nextBillingAt: row.nextBillingAt ?? null,
    graceEndsAt: row.graceEndsAt ?? null,
    exemptUntil: row.exemptUntil ?? null,
  };
}

/**
 * The org's entitlements at `nowMs`. With a subscription, its plan applies in
 * a usable state and none applies while suspended. An org without one yet
 * keeps the operator assignment or default plan it had before subscriptions,
 * until the subscription migrations have run. Operator overrides
 * (`accountPlans`) apply on top either way.
 */
export async function accountEntitlements(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  nowMs: number
): Promise<Entitlements> {
  const assignment = await ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  const row = await subscriptionFor(ctx, accountId);
  const subscription = subscriptionSummary(row);
  if (row !== null) {
    const plan = subscription !== null && isUsable(subscription) ? await tierPlan(ctx, subscription.plan) : null;
    const overrides = assignment === null ? null : { ...assignment, planId: undefined };
    return resolveEntitlements(plan, overrides, nowMs, ENTITLEMENT_CATALOG, {
      subscription,
      grantedFeatures: addOnFeatures(subscription, row.addOns),
    });
  }
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

export type EntitlementRefusal =
  | { code: "not_available_self_hosted"; feature: EntitlementFeatureKey; message: string }
  | { code: "not_entitled"; feature: EntitlementFeatureKey; message: string }
  | { code: "subscription_suspended"; reason: LifecycleReason | null; message: string };

/**
 * Throws unless the engine offers the feature. A Convex function that serves
 * a paid feature calls this, so a hidden button is not the only thing between
 * an org and the feature.
 */
export async function requireFeature(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  feature: EntitlementFeatureKey
): Promise<void> {
  const availability = await engineAvailability(ctx, instanceId, Date.now());
  const { description } = ENTITLEMENT_FEATURES[feature];
  if (availability.availability === "self_hosted") {
    throw new ConvexError<EntitlementRefusal>({
      code: "not_available_self_hosted",
      feature,
      message: `Available on hosted engines: ${description}`,
    });
  }
  if (!hasFeature(availability, feature)) {
    throw new ConvexError<EntitlementRefusal>({
      code: "not_entitled",
      feature,
      message: `Not included in your plan: ${description}`,
    });
  }
}

/**
 * The org's subscription when it is usable; throws while it is suspended or
 * missing. For managed-engine paths only: self-hosted engines need none.
 */
export async function requireUsableSubscription(
  ctx: QueryCtx,
  accountId: Id<"accounts">
): Promise<SubscriptionSummary> {
  const subscription = subscriptionSummary(await subscriptionFor(ctx, accountId));
  if (subscription === null || !isUsable(subscription)) {
    throw new ConvexError<EntitlementRefusal>({
      code: "subscription_suspended",
      reason: subscription?.stateReason ?? null,
      message: "This organization's subscription isn't active. The owner can reactivate it in Billing.",
    });
  }
  return subscription;
}

/**
 * Whether the engine's org has no seat left for one more person (the
 * `org.members` limit, which counts every org member, owner included). Only
 * a hosted engine's plan limits seats.
 */
export async function orgSeatsFull(ctx: QueryCtx, instanceId: Id<"instances">, nowMs: number): Promise<boolean> {
  const availability = await engineAvailability(ctx, instanceId, nowMs);
  if (availability.availability === "self_hosted") {
    return false;
  }
  const limit = availability.entitlements.limits["org.members"];
  if (limit === undefined) {
    throw new Error('Limit "org.members" was not resolved');
  }
  if (limit === null) {
    return false;
  }
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error(`orgSeatsFull: instance ${instanceId} does not exist`);
  }
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", instance.accountId))
    .take(limit + 1);
  return members.length >= limit;
}
