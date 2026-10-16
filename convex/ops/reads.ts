import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { accountEntitlements } from "../lib/entitlementAccess";
import {
  type AccountSummaryDto,
  type AuditEntryDto,
  accountSummaryDto,
  auditEntryDto,
  type InstanceDto,
  type InvitationDto,
  instanceDto,
  invitationDto,
  type PlanSummaryDto,
  type ProvisioningDto,
  planSummaryDto,
  provisioningDto,
  type UserDto,
  type UserRefDto,
  userDto,
  userRefDto,
} from "../lib/ops/dto";
import type { AssignmentRow, PlanRow } from "../lib/ops/planCounts";

/**
 * The ops API's reads. Only ops/http.ts calls these, after it has
 * authenticated the backoffice; each returns DTOs from lib/ops/dto.ts.
 * Ids arrive as strings from a URL, so each is normalized before use and an
 * unknown id answers null.
 */

const PAGE_SIZE = 25;
const MEMBER_CAP = 500;

export interface Page<T> {
  page: T[];
  /** Pass back to get the next page; null when there is none. */
  cursor: string | null;
}

const cursorArg = v.union(v.string(), v.null());

/**
 * Users, newest first; or the users matching `q`: an email address exactly,
 * a Twitch user id exactly, or else words of the user's name. Sign-in keeps
 * a Twitch user's display name and id, not their login.
 */
export const searchUsers = internalQuery({
  args: { q: v.optional(v.string()), cursor: cursorArg },
  handler: async (ctx, { q, cursor }): Promise<Page<UserDto>> => {
    const term = q?.trim() ?? "";
    if (term.includes("@")) {
      const users = await ctx.db
        .query("users")
        .withIndex("email", (index) => index.eq("email", term))
        .take(PAGE_SIZE);
      return { page: await Promise.all(users.map((user) => toUserDto(ctx, user))), cursor: null };
    }
    if (/^\d+$/.test(term)) {
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (index) => index.eq("provider", "twitch").eq("providerAccountId", term))
        .take(PAGE_SIZE);
      const users = (await Promise.all(accounts.map((account) => ctx.db.get(account.userId)))).filter(
        (user): user is Doc<"users"> => user !== null
      );
      return { page: await Promise.all(users.map((user) => toUserDto(ctx, user))), cursor: null };
    }
    const result =
      term === ""
        ? await ctx.db.query("users").order("desc").paginate({ numItems: PAGE_SIZE, cursor })
        : await ctx.db
            .query("users")
            .withSearchIndex("search_name", (index) => index.search("name", term))
            .paginate({ numItems: PAGE_SIZE, cursor });
    return {
      page: await Promise.all(result.page.map((user) => toUserDto(ctx, user))),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export interface UserDetailDto {
  user: UserDto;
  accounts: { accountId: string; name: string; role: string }[];
  instances: { instanceId: string; accountId: string; name: string; role: string }[];
  activeSessionCount: number;
}

export const getUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<UserDetailDto | null> => {
    const userId = ctx.db.normalizeId("users", args.userId);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!userId || !user) {
      return null;
    }
    const accountMemberships = await ctx.db
      .query("accountMembers")
      .withIndex("by_user", (index) => index.eq("userId", userId))
      .take(MEMBER_CAP);
    const accounts = [];
    for (const membership of accountMemberships) {
      const account = await ctx.db.get(membership.accountId);
      if (account) {
        accounts.push({ accountId: account._id, name: account.name, role: membership.role });
      }
    }
    const instanceMemberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (index) => index.eq("userId", userId))
      .take(MEMBER_CAP);
    const instances = [];
    for (const membership of instanceMemberships) {
      const instance = await ctx.db.get(membership.instanceId);
      if (instance) {
        instances.push({
          instanceId: instance._id,
          accountId: instance.accountId,
          name: instance.name,
          role: membership.role,
        });
      }
    }
    const now = Date.now();
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (index) => index.eq("userId", userId))
      .take(MEMBER_CAP);
    return {
      user: await toUserDto(ctx, user),
      accounts,
      instances,
      activeSessionCount: sessions.filter((session) => session.expirationTime > now).length,
    };
  },
});

/** Accounts, newest first; or the accounts whose name matches `q`. */
export const searchAccounts = internalQuery({
  args: { q: v.optional(v.string()), cursor: cursorArg },
  handler: async (ctx, { q, cursor }): Promise<Page<AccountSummaryDto>> => {
    const term = q?.trim() ?? "";
    const result =
      term === ""
        ? await ctx.db.query("accounts").order("desc").paginate({ numItems: PAGE_SIZE, cursor })
        : await ctx.db
            .query("accounts")
            .withSearchIndex("search_name", (index) => index.search("name", term))
            .paginate({ numItems: PAGE_SIZE, cursor });
    return {
      page: await Promise.all(result.page.map((account) => toAccountSummary(ctx, account))),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});

export interface AccountDetailDto {
  account: AccountSummaryDto;
  members: { user: UserRefDto; role: string }[];
  invitations: InvitationDto[];
  entitlements: PlanSummaryDto;
  instances: { instance: InstanceDto; provisioning: ProvisioningDto | null }[];
}

export const getAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args): Promise<AccountDetailDto | null> => {
    const accountId = ctx.db.normalizeId("accounts", args.accountId);
    const account = accountId ? await ctx.db.get(accountId) : null;
    if (!accountId || !account) {
      return null;
    }
    const memberRows = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (index) => index.eq("accountId", accountId))
      .take(MEMBER_CAP);
    const members = [];
    for (const row of memberRows) {
      const user = await ctx.db.get(row.userId);
      if (user) {
        members.push({ user: userRefDto(user), role: row.role });
      }
    }
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_account", (index) => index.eq("accountId", accountId))
      .take(MEMBER_CAP);
    const instanceRows = await ctx.db
      .query("instances")
      .withIndex("by_account", (index) => index.eq("accountId", accountId))
      .take(MEMBER_CAP);
    const instances = [];
    for (const instance of instanceRows) {
      const provisioning = await ctx.db
        .query("engineProvisioning")
        .withIndex("by_instance", (index) => index.eq("instanceId", instance._id))
        .first();
      instances.push({
        instance: instanceDto(instance),
        provisioning: provisioning ? provisioningDto(provisioning) : null,
      });
    }
    return {
      account: await toAccountSummary(ctx, account),
      members,
      invitations: invitations.filter((invitation) => invitation.status === "pending").map(invitationDto),
      entitlements: planSummaryDto(await accountEntitlements(ctx, accountId)),
      instances,
    };
  },
});

export interface EngineDetailDto {
  provisioning: ProvisioningDto;
  instance: InstanceDto | null;
  account: AccountSummaryDto | null;
}

export const engineByMaintenanceId = internalQuery({
  args: { engineId: v.string() },
  handler: async (ctx, { engineId }): Promise<EngineDetailDto | null> => {
    const row = await ctx.db
      .query("engineProvisioning")
      .withIndex("by_maintenance_engine", (index) => index.eq("maintenanceEngineId", engineId))
      .first();
    if (!row) {
      return null;
    }
    const instance = await ctx.db.get(row.instanceId);
    const account = await ctx.db.get(row.accountId);
    return {
      provisioning: provisioningDto(row),
      instance: instance ? instanceDto(instance) : null,
      account: account ? await toAccountSummary(ctx, account) : null,
    };
  },
});

const provisioningStatus = v.union(
  v.literal("requested"),
  v.literal("provisioning"),
  v.literal("ready"),
  v.literal("registering"),
  v.literal("registered"),
  v.literal("upgrading"),
  v.literal("failed"),
  v.literal("deprovisioning"),
  v.literal("deleted")
);

/** Every engineProvisioning row, or those in one status, for drift checks against the maintenance API. */
export const listEngines = internalQuery({
  args: { status: v.optional(provisioningStatus), cursor: cursorArg },
  handler: async (ctx, { status, cursor }): Promise<Page<ProvisioningDto>> => {
    const result =
      status === undefined
        ? await ctx.db.query("engineProvisioning").paginate({ numItems: PAGE_SIZE * 4, cursor })
        : await ctx.db
            .query("engineProvisioning")
            .withIndex("by_status", (index) => index.eq("status", status))
            .paginate({ numItems: PAGE_SIZE * 4, cursor });
    return { page: result.page.map(provisioningDto), cursor: result.isDone ? null : result.continueCursor };
  },
});

export interface InstanceHealthDto {
  instance: InstanceDto;
  live: { isLive: boolean; startedAt: string | null; lastUpdatedAt: number; lastUpdateSource: string } | null;
  sync: {
    status: string;
    lastSyncedAt: number;
    lastError: string;
    consecutiveErrorCount: number;
    lastDurationMs: number;
  } | null;
  recentAlerts: { engineAlertId: string; status: string; error: string | null; createdAt: number }[];
  failingWorkflows: { engineWorkflowId: string; reason: string | null; since: string }[];
}

export const instanceHealth = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<InstanceHealthDto | null> => {
    const instanceId = ctx.db.normalizeId("instances", args.instanceId);
    const instance = instanceId ? await ctx.db.get(instanceId) : null;
    if (!instanceId || !instance) {
      return null;
    }
    const live = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (index) => index.eq("instanceId", instanceId))
      .first();
    const sync = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (index) => index.eq("instanceId", instanceId))
      .first();
    const alerts = await ctx.db
      .query("engineAlerts")
      .withIndex("by_instance", (index) => index.eq("instanceId", instanceId))
      .order("desc")
      .take(20);
    const failing = await ctx.db
      .query("workflowHealth")
      .withIndex("by_instance_status", (index) => index.eq("instanceId", instanceId).eq("status", "error"))
      .take(50);
    return {
      instance: instanceDto(instance),
      live: live
        ? {
            isLive: live.isLive,
            startedAt: live.startedAt ?? null,
            lastUpdatedAt: live.lastUpdatedAt,
            lastUpdateSource: live.lastUpdateSource,
          }
        : null,
      sync: sync
        ? {
            status: sync.status,
            lastSyncedAt: sync.lastSyncedAt,
            lastError: sync.lastError,
            consecutiveErrorCount: sync.consecutiveErrorCount,
            lastDurationMs: sync.lastDurationMs,
          }
        : null,
      recentAlerts: alerts.map((alert) => ({
        engineAlertId: alert.engineAlertId,
        status: alert.status,
        error: alert.error ?? null,
        createdAt: alert.createdAt,
      })),
      failingWorkflows: failing.map((row) => ({
        engineWorkflowId: row.engineWorkflowId,
        reason: row.reason ?? null,
        since: row.since,
      })),
    };
  },
});

/**
 * The provisioning row an operator action works on, with every field: only
 * ops/engines.ts reads it, and nothing of it is returned over HTTP.
 */
export const provisioningForInstance = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args): Promise<Doc<"engineProvisioning"> | null> => {
    const instanceId = ctx.db.normalizeId("instances", args.instanceId);
    if (!instanceId) {
      return null;
    }
    return ctx.db
      .query("engineProvisioning")
      .withIndex("by_instance", (index) => index.eq("instanceId", instanceId))
      .first();
  },
});

/** The ops audit log, newest first, optionally for one operator or one target. */
export const listAudit = internalQuery({
  args: { actor: v.optional(v.string()), target: v.optional(v.string()), cursor: cursorArg },
  handler: async (ctx, { actor, target, cursor }): Promise<Page<AuditEntryDto>> => {
    if (actor !== undefined && target !== undefined) {
      throw new Error("Filter by actor or by target, not both");
    }
    const base = ctx.db.query("opsAuditLog");
    const ordered =
      actor !== undefined
        ? base.withIndex("by_actor", (index) => index.eq("actor", actor)).order("desc")
        : target !== undefined
          ? base.withIndex("by_target", (index) => index.eq("target", target)).order("desc")
          : base.withIndex("by_at").order("desc");
    const result = await ordered.paginate({ numItems: PAGE_SIZE * 2, cursor });
    return { page: result.page.map(auditEntryDto), cursor: result.isDone ? null : result.continueCursor };
  },
});

async function toUserDto(ctx: QueryCtx, user: Doc<"users">): Promise<UserDto> {
  const authAccounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (index) => index.eq("userId", user._id))
    .take(10);
  const lastSession = await ctx.db
    .query("authSessions")
    .withIndex("userId", (index) => index.eq("userId", user._id))
    .order("desc")
    .first();
  return userDto(user, authAccounts, lastSession);
}

async function toAccountSummary(ctx: QueryCtx, account: Doc<"accounts">): Promise<AccountSummaryDto> {
  const owner = await ctx.db.get(account.ownerId);
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (index) => index.eq("accountId", account._id))
    .take(MEMBER_CAP);
  const engines = await ctx.db
    .query("engineProvisioning")
    .withIndex("by_account", (index) => index.eq("accountId", account._id))
    .take(MEMBER_CAP);
  return accountSummaryDto(
    account,
    owner,
    members.length,
    await accountEntitlements(ctx, account._id),
    engines.filter((engine) => engine.status !== "deleted").length
  );
}

/**
 * Plan counts read every account and assignment, so they come a page at a time: ops/http.ts walks the pages, and
 * each query stays inside Convex's per-query read limit however many accounts there are.
 */
const COUNT_PAGE_SIZE = 4000;

export const plansForCount = internalQuery({
  args: {},
  handler: async (ctx): Promise<PlanRow[]> => {
    const plans = await ctx.db.query("plans").collect();
    return plans.map((plan) => ({
      id: plan._id,
      key: plan.key,
      name: plan.name,
      offered: plan.offered,
      isDefault: plan.isDefault,
    }));
  },
});

export const accountCountPage = internalQuery({
  args: { cursor: cursorArg },
  handler: async (ctx, { cursor }): Promise<{ count: number; cursor: string | null }> => {
    const result = await ctx.db.query("accounts").paginate({ numItems: COUNT_PAGE_SIZE, cursor });
    return { count: result.page.length, cursor: result.isDone ? null : result.continueCursor };
  },
});

export const assignmentPage = internalQuery({
  args: { cursor: cursorArg },
  handler: async (ctx, { cursor }): Promise<{ assignments: AssignmentRow[]; cursor: string | null }> => {
    const result = await ctx.db.query("accountPlans").paginate({ numItems: COUNT_PAGE_SIZE, cursor });
    return {
      assignments: result.page.map((row) => ({
        ...(row.planId === undefined ? {} : { planId: row.planId }),
        ...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt }),
      })),
      cursor: result.isDone ? null : result.continueCursor,
    };
  },
});
