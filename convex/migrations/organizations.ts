import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type QueryCtx } from "../_generated/server";
import { orgRoleOf } from "../lib/orgRoles";
import { applyOrgRoleToEngines, getAccountMembership, grantEngineRole } from "../lib/teamAccess";
import { logger } from "../logger";
import { migrations } from "./index";

// Brings existing data to the organization model's invariants (I1-I4 in
// lib/teamAccess.ts and lib/orgRoles.ts). Run orgOwnerRows, then
// orgMembershipFromEngines, then checkOrgInvariantsAll, which must report none.

/**
 * M1: every org's owner has an `owner` membership row and nobody else does
 * (I1); other `owner` rows become `admin`. Then the org's floors hold on each
 * of its engines: the owner owns it (I3) and every org admin is at least
 * engine admin (I4). An owner whose user is gone, or who has several
 * membership rows, is reported and left for an operator; the other orgs still
 * migrate.
 */
export const orgOwnerRows = migrations.define({
  table: "accounts",
  migrateOne: async (ctx, account) => {
    if ((await ctx.db.get(account.ownerId)) === null) {
      logger.warn("orgOwnerRows: org owner's user is gone", { accountId: account._id, ownerId: account.ownerId });
      return;
    }
    const rows = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    const ownerRows = rows.filter((row) => row.userId === account.ownerId);
    if (ownerRows.length > 1) {
      // Migrations only insert and patch, so which row to keep is an operator's call.
      logger.warn("orgOwnerRows: org has several membership rows for its owner", {
        accountId: account._id,
        ownerId: account.ownerId,
        rows: ownerRows.length,
      });
      return;
    }
    const ownerRow: Doc<"accountMembers"> | undefined = ownerRows[0];
    for (const row of rows) {
      if (row.userId !== account.ownerId && row.role === "owner") {
        await ctx.db.patch(row._id, { role: "admin" });
      }
    }
    if (ownerRow === undefined) {
      await ctx.db.insert("accountMembers", {
        accountId: account._id,
        userId: account.ownerId,
        role: "owner",
        createdAt: account.createdAt,
      });
    } else if (ownerRow.role !== "owner") {
      await ctx.db.patch(ownerRow._id, { role: "owner" });
    }

    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    for (const instance of instances) {
      await grantEngineRole(ctx, instance._id, account.ownerId, "owner");
    }
    for (const row of rows) {
      if (row.userId !== account.ownerId && (await orgRoleOf(ctx, account, row.userId)) === "admin") {
        await applyOrgRoleToEngines(ctx, account._id, row.userId, "admin");
      }
    }
  },
});

/**
 * M2: every engine member is in the engine's org (I2), and only the org owner
 * owns an engine (I3): an engine `owner` who doesn't own the org becomes an
 * org admin, with engine `admin` on every engine of the org (I4). An engine
 * whose org is gone is reported.
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
  | {
      invariant: "I1";
      accountId: Id<"accounts">;
      detail: "owner_row_missing" | "owner_row_not_owner" | "owner_row_duplicated";
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
  | { invariant: "I4"; accountId: Id<"accounts">; instanceId: Id<"instances">; userId: Id<"users"> };

async function orgViolations(ctx: QueryCtx, account: Doc<"accounts">): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  const accountId = account._id;
  const orgRows = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const ownerRows = orgRows.filter((row) => row.userId === account.ownerId);
  const ownerRow = ownerRows[0];
  if (ownerRows.length > 1) {
    violations.push({ invariant: "I1", accountId, detail: "owner_row_duplicated" });
  }
  if (ownerRow === undefined) {
    violations.push({ invariant: "I1", accountId, detail: "owner_row_missing" });
  } else if (ownerRow.role !== "owner") {
    violations.push({ invariant: "I1", accountId, detail: "owner_row_not_owner" });
  }
  for (const row of orgRows) {
    if (row.role === "owner" && row.userId !== account.ownerId) {
      violations.push({ invariant: "I1", accountId, detail: "extra_owner_row", userId: row.userId });
    }
  }
  const orgAdmins = orgRows.filter((row) => row.role === "admin").map((row) => row.userId);

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
    if (engineRole.get(account.ownerId) !== "owner") {
      violations.push({
        invariant: "I3",
        accountId,
        instanceId,
        userId: account.ownerId,
        detail: "owner_not_engine_owner",
      });
    }
    for (const row of engineRows) {
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

const CHECK_PAGE_SIZE = 50;

/**
 * M5, one page of orgs: the invariant violations it finds. Read-only. I5
 * (members hold only engines they were granted) has no stored trace to check.
 */
export const checkOrgInvariants = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("accounts").paginate({ cursor, numItems: CHECK_PAGE_SIZE });
    const violations: InvariantViolation[] = [];
    for (const account of page.page) {
      violations.push(...(await orgViolations(ctx, account)));
    }
    return { violations, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/**
 * M5 over every org: `bunx convex run migrations/organizations:checkOrgInvariantsAll`.
 * Zero violations is the precondition for dropping the old shapes.
 */
export const checkOrgInvariantsAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ total: number; violations: InvariantViolation[] }> => {
    const violations: InvariantViolation[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: { violations: InvariantViolation[]; continueCursor: string; isDone: boolean } = await ctx.runQuery(
        internal.migrations.organizations.checkOrgInvariants,
        { cursor }
      );
      violations.push(...page.violations);
      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }
    return { total: violations.length, violations };
  },
});
