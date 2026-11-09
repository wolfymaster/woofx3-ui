import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "../_generated/server";
import { orgSeatLimit } from "../lib/entitlementAccess";
import { isAssignmentActive } from "../lib/entitlements";
import { orgRoleOf } from "../lib/orgRoles";
import { subscriptionFor } from "../lib/subscriptions";
import { applyOrgRoleToEngines, getAccountMembership, grantEngineRole } from "../lib/teamAccess";
import { logger } from "../logger";
import { migrations } from "./index";
import { isPlanTier } from "./subscriptions";

// Brings existing data to the organization model's invariants (I1-I4 in
// lib/teamAccess.ts and lib/orgRoles.ts). Run orgOwnerRows, then
// orgMembershipFromEngines, then checkOrgInvariantsAll, which must report no
// violations. It also lists orgs over their seat limit, which M2 allows.

/**
 * M1: every org's owner has an `owner` membership row and nobody else does
 * (I1); other `owner` rows become `admin`. Then the org's floors hold on each
 * of its engines: the owner owns it (I3) and every org admin is at least
 * engine admin (I4). Two cases are logged and left for an operator, and the
 * org's other members still migrate: an owner whose user is gone, and an
 * owner with several membership rows (which row to keep is an operator's
 * call, since migrations only insert and patch). A member whose user is gone
 * is skipped. checkOrgInvariantsAll lists all three.
 */
export const orgOwnerRows = migrations.define({
  table: "accounts",
  migrateOne: async (ctx, account) => {
    const ownerExists = (await ctx.db.get(account.ownerId)) !== null;
    if (!ownerExists) {
      logger.warn("orgOwnerRows: org owner's user is gone", { accountId: account._id, ownerId: account.ownerId });
    }
    const rows = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const members: Array<Doc<"accountMembers">> = [];
    for (const row of rows) {
      if (row.userId === account.ownerId) {
        continue;
      }
      if ((await ctx.db.get(row.userId)) === null) {
        logger.warn("orgOwnerRows: member's user is gone; skipped", { accountId: account._id, userId: row.userId });
        continue;
      }
      members.push(row);
    }
    for (const row of members) {
      if (row.role === "owner") {
        await ctx.db.patch(row._id, { role: "admin" });
      }
    }
    if (ownerExists) {
      await ownerRowAndEngines(ctx, account, rows);
    }
    for (const row of members) {
      if ((await orgRoleOf(ctx, account, row.userId)) === "admin") {
        await applyOrgRoleToEngines(ctx, account._id, row.userId, "admin");
      }
    }
  },
});

async function ownerRowAndEngines(
  ctx: MutationCtx,
  account: Doc<"accounts">,
  rows: Array<Doc<"accountMembers">>
): Promise<void> {
  const ownerRows = rows.filter((row) => row.userId === account.ownerId);
  if (ownerRows.length > 1) {
    logger.warn("orgOwnerRows: org has several membership rows for its owner; left for an operator", {
      accountId: account._id,
      ownerId: account.ownerId,
      rows: ownerRows.length,
    });
  } else if (ownerRows.length === 0) {
    await ctx.db.insert("accountMembers", {
      accountId: account._id,
      userId: account.ownerId,
      role: "owner",
      createdAt: account.createdAt,
    });
  } else if (ownerRows[0].role !== "owner") {
    await ctx.db.patch(ownerRows[0]._id, { role: "owner" });
  }
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  for (const instance of instances) {
    await grantEngineRole(ctx, instance._id, account.ownerId, "owner");
  }
}

/**
 * M2: every engine member is in the engine's org (I2), and only the org owner
 * owns an engine (I3): an engine `owner` who doesn't own the org becomes an
 * org admin, with engine `admin` on every engine of the org (I4). An engine
 * whose org is gone is logged, and a member whose user is gone is skipped;
 * checkOrgInvariantsAll lists both.
 */
export const orgMembershipFromEngines = migrations.define({
  table: "instanceMembers",
  migrateOne: async (ctx, membership) => {
    const instance = await ctx.db.get(membership.instanceId);
    const account = instance ? await ctx.db.get(instance.accountId) : null;
    if (instance === null || account === null) {
      logger.warn("orgMembershipFromEngines: engine membership without an engine or org", {
        instanceMemberId: membership._id,
        instanceId: membership.instanceId,
      });
      return;
    }
    if (membership.userId === account.ownerId) {
      return;
    }
    if ((await ctx.db.get(membership.userId)) === null) {
      logger.warn("orgMembershipFromEngines: engine member's user is gone; skipped", {
        instanceMemberId: membership._id,
        userId: membership.userId,
      });
      return;
    }
    // Someone already on an engine keeps their access past the seat limit, so
    // they join the org here rather than through grantEngineRole's seat check.
    // checkOrgInvariantsAll lists the orgs this leaves over their limit.
    if ((await getAccountMembership(ctx, account._id, membership.userId)) === null) {
      await ctx.db.insert("accountMembers", {
        accountId: account._id,
        userId: membership.userId,
        role: "member",
        createdAt: membership.createdAt ?? account.createdAt,
      });
    }
    if (membership.role === "owner") {
      await grantEngineRole(ctx, instance._id, membership.userId, "member");
      const orgRow = await getAccountMembership(ctx, account._id, membership.userId);
      if (orgRow === null) {
        throw new Error(`orgMembershipFromEngines: ${membership.userId} has no org row after the engine grant`);
      }
      await ctx.db.patch(orgRow._id, { role: "admin" });
      await applyOrgRoleToEngines(ctx, account._id, membership.userId, "admin");
      return;
    }
    await grantEngineRole(ctx, instance._id, membership.userId, membership.role);
  },
});

export type InvariantViolation =
  | { invariant: "duplicate_membership"; accountId: Id<"accounts">; userId: Id<"users">; rows: number }
  | {
      invariant: "I1";
      accountId: Id<"accounts">;
      detail: "owner_row_missing" | "owner_row_not_owner";
    }
  | { invariant: "I1"; accountId: Id<"accounts">; detail: "extra_owner_row"; userId: Id<"users"> }
  | { invariant: "I2"; accountId: Id<"accounts">; instanceId: Id<"instances">; userId: Id<"users"> }
  | {
      invariant: "I3";
      accountId: Id<"accounts">;
      instanceId: Id<"instances">;
      userId: Id<"users">;
      detail: "owner_not_engine_owner" | "non_owner_engine_owner";
    }
  | { invariant: "I4"; accountId: Id<"accounts">; instanceId: Id<"instances">; userId: Id<"users"> }
  | {
      invariant: "subscription";
      accountId: Id<"accounts">;
      detail: "managed_engine_without_subscription" | "comped_not_exempt";
    }
  | { invariant: "owner_user_missing"; accountId: Id<"accounts">; userId: Id<"users"> }
  | {
      invariant: "member_user_missing";
      accountId: Id<"accounts">;
      userId: Id<"users">;
      instanceId?: Id<"instances">;
    }
  | { invariant: "orphan_engine"; accountId: Id<"accounts">; instanceId: Id<"instances"> };

/** Whether the org holds an active operator assignment of a tier plan, which M6 turns into an exemption. */
async function isComped(ctx: QueryCtx, accountId: Id<"accounts">, nowMs: number): Promise<boolean> {
  const assignment = await ctx.db
    .query("accountPlans")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();
  if (assignment?.planId === undefined || !isAssignmentActive(assignment, nowMs)) {
    return false;
  }
  const plan = await ctx.db.get(assignment.planId);
  return plan !== null && isPlanTier(plan.key);
}

async function orgViolations(ctx: QueryCtx, account: Doc<"accounts">, nowMs: number): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const accountId = account._id;
  const userGone = new Map<Id<"users">, boolean>();
  const isGone = async (userId: Id<"users">): Promise<boolean> => {
    let gone = userGone.get(userId);
    if (gone === undefined) {
      gone = (await ctx.db.get(userId)) === null;
      userGone.set(userId, gone);
    }
    return gone;
  };
  const ownerGone = await isGone(account.ownerId);
  if (ownerGone) {
    violations.push({ invariant: "owner_user_missing", accountId, userId: account.ownerId });
  }
  const allOrgRows = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  // A row whose user is gone is reported once, as itself, rather than as every invariant it breaks.
  const orgRows: Array<Doc<"accountMembers">> = [];
  for (const row of allOrgRows) {
    if (row.userId !== account.ownerId && (await isGone(row.userId))) {
      violations.push({ invariant: "member_user_missing", accountId, userId: row.userId });
    } else {
      orgRows.push(row);
    }
  }
  const rowsPerUser = new Map<Id<"users">, number>();
  for (const row of orgRows) {
    rowsPerUser.set(row.userId, (rowsPerUser.get(row.userId) ?? 0) + 1);
  }
  for (const [userId, rows] of rowsPerUser) {
    if (rows > 1) {
      violations.push({ invariant: "duplicate_membership", accountId, userId, rows });
    }
  }
  const ownerRow = orgRows.find((row) => row.userId === account.ownerId);
  // A gone owner is reported once, above: their row and engines wait for an operator to name a new owner.
  if (!ownerGone && ownerRow === undefined) {
    violations.push({ invariant: "I1", accountId, detail: "owner_row_missing" });
  } else if (!ownerGone && ownerRow !== undefined && ownerRow.role !== "owner") {
    violations.push({ invariant: "I1", accountId, detail: "owner_row_not_owner" });
  }
  for (const row of orgRows) {
    if (row.role === "owner" && row.userId !== account.ownerId) {
      violations.push({ invariant: "I1", accountId, detail: "extra_owner_row", userId: row.userId });
    }
  }
  const orgAdmins = orgRows.filter((row) => row.role === "admin").map((row) => row.userId);

  const provisioning = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(50);
  if (provisioning.some((row) => row.status !== "deleted") && (await subscriptionFor(ctx, accountId)) === null) {
    violations.push({ invariant: "subscription", accountId, detail: "managed_engine_without_subscription" });
  }
  if ((await isComped(ctx, accountId, nowMs)) && (await subscriptionFor(ctx, accountId))?.state !== "exempt") {
    violations.push({ invariant: "subscription", accountId, detail: "comped_not_exempt" });
  }

  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  for (const instance of instances) {
    const instanceId = instance._id;
    const engineRows = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const engineRole = new Map(engineRows.map((row) => [row.userId, row.role]));
    if (!ownerGone && engineRole.get(account.ownerId) !== "owner") {
      violations.push({
        invariant: "I3",
        accountId,
        instanceId,
        userId: account.ownerId,
        detail: "owner_not_engine_owner",
      });
    }
    for (const row of engineRows) {
      if (row.userId !== account.ownerId && (await isGone(row.userId))) {
        violations.push({ invariant: "member_user_missing", accountId, userId: row.userId, instanceId });
        continue;
      }
      if ((await orgRoleOf(ctx, account, row.userId)) === null) {
        violations.push({ invariant: "I2", accountId, instanceId, userId: row.userId });
      }
      if (row.role === "owner" && row.userId !== account.ownerId) {
        violations.push({
          invariant: "I3",
          accountId,
          instanceId,
          userId: row.userId,
          detail: "non_owner_engine_owner",
        });
      }
    }
    for (const userId of orgAdmins) {
      const role = engineRole.get(userId);
      if (role !== "admin" && role !== "owner") {
        violations.push({ invariant: "I4", accountId, instanceId, userId });
      }
    }
  }
  return violations;
}

/** An org with more members than its seat limit; M2 keeps existing members rather than drop them. */
export interface OverSeatLimit {
  accountId: Id<"accounts">;
  members: number;
  limit: number;
}

async function overSeatLimit(ctx: QueryCtx, accountId: Id<"accounts">, nowMs: number): Promise<OverSeatLimit | null> {
  const limit = await orgSeatLimit(ctx, accountId, nowMs);
  if (limit === null) {
    return null;
  }
  const members = (
    await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()
  ).length;
  return members > limit ? { accountId, members, limit } : null;
}

const CHECK_PAGE_SIZE = 50;

/**
 * M5, one page of orgs: the invariant violations it finds, including orgs
 * with a managed engine but no subscription, and the orgs over their seat
 * limit, which are reported but are not violations. Read-only. I5
 * (members hold only engines they were granted) has no stored trace to check.
 */
export const checkOrgInvariants = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("accounts").paginate({ cursor, numItems: CHECK_PAGE_SIZE });
    const violations: InvariantViolation[] = [];
    const overLimit: OverSeatLimit[] = [];
    const now = Date.now();
    for (const account of page.page) {
      violations.push(...(await orgViolations(ctx, account, now)));
      const over = await overSeatLimit(ctx, account._id, now);
      if (over !== null) {
        overLimit.push(over);
      }
    }
    return { violations, overSeatLimit: overLimit, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** M5, one page of engines: those whose org is gone, which the walk over orgs cannot see. Read-only. */
export const checkOrphanEngines = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("instances").paginate({ cursor, numItems: CHECK_PAGE_SIZE });
    const violations: InvariantViolation[] = [];
    for (const instance of page.page) {
      if ((await ctx.db.get(instance.accountId)) === null) {
        violations.push({ invariant: "orphan_engine", accountId: instance.accountId, instanceId: instance._id });
      }
    }
    return { violations, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * M5 over every org and engine: `bunx convex run migrations/organizations:checkOrgInvariantsAll`.
 * Zero violations is the precondition for dropping the old shapes; orgs over
 * their seat limit keep their members and only stop taking new ones.
 */
export const checkOrgInvariantsAll = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ total: number; violations: InvariantViolation[]; overSeatLimit: OverSeatLimit[] }> => {
    const violations: InvariantViolation[] = [];
    const overLimit: OverSeatLimit[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: {
        violations: InvariantViolation[];
        overSeatLimit: OverSeatLimit[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(internal.migrations.organizations.checkOrgInvariants, { cursor });
      violations.push(...page.violations);
      overLimit.push(...page.overSeatLimit);
      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
    cursor = null;
    for (;;) {
      const page: { violations: InvariantViolation[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
        internal.migrations.organizations.checkOrphanEngines,
        { cursor }
      );
      violations.push(...page.violations);
      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
    return { total: violations.length, violations, overSeatLimit: overLimit };
  },
});
