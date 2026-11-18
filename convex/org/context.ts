import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { entitlementsFor, isSeated, seatLimitOf } from "../lib/entitlementAccess";
import type { Entitlements } from "../lib/entitlements";
import type { OrgRole } from "../lib/organization";
import { billingFor, type OrgBilling } from "./billing";
import { orgRoleOf } from "./policy";

/**
 * What one request knows about an org, read once and passed down, so a reader
 * that needs the role, the billing, the entitlements and the seats does not
 * read the projection and the plan again for each.
 */
export interface OrgContext {
  account: Doc<"accounts">;
  role: OrgRole;
  /** Null until the plane has pushed a projection (see billingFor). */
  billing: OrgBilling | null;
  entitlements: Entitlements;
  instances: Doc<"instances">[];
  /** `limit` is null when no seat limit applies: only self-hosted engines, or a plan without one. */
  seats: { used: number; limit: number | null };
}

/** The org as `userId` sees it; null when the org does not exist or they are not in it. */
export async function loadOrgContext(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">
): Promise<OrgContext | null> {
  const account = await ctx.db.get(accountId);
  if (account === null) {
    return null;
  }
  const role = await orgRoleOf(ctx, account, userId);
  if (role === null) {
    return null;
  }
  const billing = await billingFor(ctx, accountId);
  const entitlements = await entitlementsFor(ctx, billing);
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  return {
    account,
    role,
    billing,
    entitlements,
    instances,
    seats: { used: members.length, limit: isSeated(billing, instances) ? seatLimitOf(entitlements) : null },
  };
}
