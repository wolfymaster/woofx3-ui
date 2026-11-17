import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { billingFor, type OrgBilling } from "../org/billing";
import {
  addOnFeatures,
  ENTITLEMENT_CATALOG,
  type EntitlementFeatureKey,
  type Entitlements,
  isUsable,
  resolveEntitlements,
} from "./entitlements";

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
 * The entitlements `billing` grants. With a billing projection from the
 * management plane, its tier's plan applies in a usable standing and none
 * applies while suspended, with the overrides the projection carries. An org
 * without one has no plan: the code defaults for limits, and no paid features.
 */
export async function entitlementsFor(ctx: QueryCtx, billing: OrgBilling | null): Promise<Entitlements> {
  if (billing === null) {
    return resolveEntitlements(null, null);
  }
  const { summary } = billing;
  const plan = summary.plan !== null && isUsable(summary) ? await tierPlan(ctx, summary.plan) : null;
  return resolveEntitlements(plan, billing.overrides, ENTITLEMENT_CATALOG, {
    subscription: summary,
    grantedFeatures: addOnFeatures(summary, billing.addOns),
  });
}

/** The org's entitlements (see entitlementsFor). */
export async function accountEntitlements(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Entitlements> {
  return entitlementsFor(ctx, await billingFor(ctx, accountId));
}

/**
 * Availability comes before the plan: paid features exist only on hosted
 * (managed) engines. A self-hosted engine needs no subscription, so its org's
 * plan is never read for it.
 */
export type EngineAvailability =
  | { availability: "hosted"; entitlements: Entitlements }
  | { availability: "self_hosted" };

export async function engineAvailability(ctx: QueryCtx, instanceId: Id<"instances">): Promise<EngineAvailability> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error(`engineAvailability: instance ${instanceId} does not exist`);
  }
  if (instance.hosting !== "managed") {
    return { availability: "self_hosted" };
  }
  return { availability: "hosted", entitlements: await accountEntitlements(ctx, instance.accountId) };
}

/** Whether a paid feature is on. Never on a self-hosted engine, whatever its org pays for. */
export function hasFeature(availability: EngineAvailability, feature: EntitlementFeatureKey): boolean {
  return availability.availability === "hosted" && availability.entitlements.features.includes(feature);
}

/**
 * Whether a seat limit applies to the org. Seats belong to the org, not to an
 * engine: the limit applies once the org has a plan (a projection tier) or any
 * managed engine, whichever engine a person joins through. An org with only
 * self-hosted engines has none.
 */
export function isSeated(billing: OrgBilling | null, instances: readonly Doc<"instances">[]): boolean {
  return (
    (billing !== null && billing.summary.plan !== null) || instances.some((instance) => instance.hosting === "managed")
  );
}

/** The `org.members` limit (every org member, owner included) the entitlements grant; null is unlimited. */
export function seatLimitOf(entitlements: Entitlements): number | null {
  const limit = entitlements.limits["org.members"];
  if (limit === undefined) {
    throw new Error('Limit "org.members" was not resolved');
  }
  return limit;
}

/** The org's `org.members` limit, or null when none applies (see isSeated), nor for a plan without one. */
export async function orgSeatLimit(ctx: QueryCtx, accountId: Id<"accounts">): Promise<number | null> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const billing = await billingFor(ctx, accountId);
  if (!isSeated(billing, instances)) {
    return null;
  }
  return seatLimitOf(await entitlementsFor(ctx, billing));
}
