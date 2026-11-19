import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { resyncRelayIfBridging } from "../lib/companionEndpoints";
import { orgSeatLimit } from "../lib/entitlementAccess";
import { roleSatisfies } from "../lib/instanceRoles";
import type { EngineRole } from "../lib/organization";
import { getInstanceMembership } from "../lib/teamAccess";
import { orgRoleOf } from "./policy";

// Who is in an org, and the writes that change it: joining, leaving, org role
// changes and the engine roles they imply. Everything else reads and changes
// `accountMembers` through here (see orgModuleBoundary.test.ts).

export async function getAccountMembership(ctx: QueryCtx, accountId: Id<"accounts">, userId: Id<"users">) {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_account_user", (q) => q.eq("accountId", accountId).eq("userId", userId))
    .first();
}

/** The org's members, owner included. */
export async function orgMembers(ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"accountMembers">[]> {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
}

/** One page of the org's members, for work that walks a large org in batches. */
export async function orgMembersPage(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  paginationOpts: PaginationOptions
): Promise<PaginationResult<Doc<"accountMembers">>> {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .paginate(paginationOpts);
}

/** The org the user owns, or null when they have none. */
export async function ownedAccountOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"accounts"> | null> {
  return ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .first();
}

/** The user's org memberships. An owner has one for each org they own. */
export async function membershipsOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"accountMembers">[]> {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

export const SEATS_FULL = "Your plan's seats are all taken. Upgrade or remove someone to invite more people";

/** Whether the org has no seat left for one more person (see orgSeatLimit). */
export async function orgSeatsFull(ctx: QueryCtx, accountId: Id<"accounts">): Promise<boolean> {
  const limit = await orgSeatLimit(ctx, accountId);
  if (limit === null) {
    return false;
  }
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .take(limit + 1);
  return members.length >= limit;
}

export async function insertAccount(ctx: MutationCtx, userId: Id<"users">, name: string): Promise<Id<"accounts">> {
  const now = Date.now();
  const accountId = await ctx.db.insert("accounts", { name, ownerId: userId, createdAt: now });
  await ctx.db.insert("accountMembers", { accountId, userId, role: "owner", createdAt: now });
  return accountId;
}

/**
 * Gives the user `role` on the engine, the one way engine access is granted.
 * Holds the membership invariants:
 *
 * - I2: the user joins the engine's org as a `member` when not already in it,
 *   which takes a seat: refused when the org's seats are full.
 * - I3: only the org owner holds engine `owner`, and the org owner holds
 *   nothing less, so both are refused.
 * - I4: an org admin gets at least engine `admin`; a lower role is raised.
 *
 * Returns the engine role the user now holds.
 */
export async function grantEngineRole(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">,
  role: EngineRole
): Promise<EngineRole> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error(`grantEngineRole: instance ${instanceId} does not exist`);
  }
  const account = await ctx.db.get(instance.accountId);
  if (account === null) {
    throw new Error(`grantEngineRole: instance ${instanceId} belongs to missing org ${instance.accountId}`);
  }
  const isOrgOwner = account.ownerId === userId;
  if (role === "owner" && !isOrgOwner) {
    throw new Error("Only the organization owner can own an engine");
  }
  if (isOrgOwner && role !== "owner") {
    throw new Error("The organization owner always owns its engines");
  }

  const now = Date.now();
  let orgRole = await orgRoleOf(ctx, account, userId);
  if (orgRole === null) {
    if (await orgSeatsFull(ctx, account._id)) {
      throw new Error(SEATS_FULL);
    }
    await ctx.db.insert("accountMembers", { accountId: account._id, userId, role: "member", createdAt: now });
    orgRole = "member";
  }
  const granted: EngineRole = orgRole === "admin" && !roleSatisfies(role, "admin") ? "admin" : role;

  const existing = await getInstanceMembership(ctx, instanceId, userId);
  if (existing === null) {
    await ctx.db.insert("instanceMembers", { instanceId, userId, role: granted, createdAt: now });
  } else if (existing.role !== granted) {
    await ctx.db.patch(existing._id, { role: granted });
  }
  return granted;
}

/**
 * Gives a new engine its standing members: the org owner as `owner` (I3) and
 * every org admin as `admin` (I4). Org members get it only when granted (I5).
 */
export async function grantNewEngineMembers(ctx: MutationCtx, instanceId: Id<"instances">): Promise<void> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error(`grantNewEngineMembers: instance ${instanceId} does not exist`);
  }
  const account = await ctx.db.get(instance.accountId);
  if (account === null) {
    throw new Error(`grantNewEngineMembers: instance ${instanceId} belongs to missing org ${instance.accountId}`);
  }
  await grantEngineRole(ctx, instanceId, account.ownerId, "owner");
  const members = await ctx.db
    .query("accountMembers")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  for (const member of members) {
    if (member.userId !== account.ownerId && (await orgRoleOf(ctx, account, member.userId)) === "admin") {
      await grantEngineRole(ctx, instanceId, member.userId, "admin");
    }
  }
}

/**
 * Applies an org role change to the user's engine roles (I4): promotion to
 * admin grants engine `admin` on every engine of the org; demotion to member
 * lowers their engine `admin` rows to `member` and keeps their access.
 */
export async function applyOrgRoleToEngines(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
  orgRole: "admin" | "member"
): Promise<Array<Id<"instances">>> {
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  const changed: Array<Id<"instances">> = [];
  for (const instance of instances) {
    const membership = await getInstanceMembership(ctx, instance._id, userId);
    if (orgRole === "admin" && membership?.role !== "admin") {
      await grantEngineRole(ctx, instance._id, userId, "admin");
      changed.push(instance._id);
    } else if (orgRole === "member" && membership?.role === "admin") {
      await ctx.db.patch(membership._id, { role: "member" });
      changed.push(instance._id);
    }
  }
  return changed;
}

/** Removes someone from the org and from every engine of it. The caller has decided they may, and that they are not the owner. */
export async function removeOrgMember(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  targetUserId: Id<"users">
): Promise<void> {
  const row = await getAccountMembership(ctx, accountId, targetUserId);
  if (!row) {
    throw new Error("Member not found");
  }

  await ctx.db.delete(row._id);

  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();

  for (const inst of instances) {
    const im = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", inst._id).eq("userId", targetUserId))
      .first();
    if (im) {
      await ctx.db.delete(im._id);
    }
    // A companion this member approved stops bridging with their access.
    await resyncRelayIfBridging(ctx, inst._id);
  }
}

/** Changes a member's org role and applies it to their engine roles. The caller has decided they may, and that they are not the owner. */
export async function setOrgMemberRole(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  targetUserId: Id<"users">,
  role: "admin" | "member"
): Promise<void> {
  const row = await getAccountMembership(ctx, accountId, targetUserId);
  if (!row) {
    throw new Error("Member not found");
  }
  if (row.role === "owner") {
    throw new Error("Cannot demote an owner membership row");
  }

  await ctx.db.patch(row._id, { role });

  // A companion this member approved bridges only while they are an engine admin.
  for (const instanceId of await applyOrgRoleToEngines(ctx, accountId, targetUserId, role)) {
    await resyncRelayIfBridging(ctx, instanceId);
  }
}
