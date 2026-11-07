import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { roleSatisfies } from "./instanceRoles";
import type { EngineRole, OrgRole } from "./organization";
import { orgRoleOf } from "./orgRoles";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getInstanceMembership(ctx: QueryCtx, instanceId: Id<"instances">, userId: Id<"users">) {
  return ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

/**
 * Whether the caller is signed in and a member of the instance.
 *
 * For read paths that answer with nothing rather than raising: every one of
 * these is a live `useQuery` subscription, and a throw during the moment
 * between mount and auth resolving surfaces in the UI as a crashed panel
 * instead of an empty one. Callers that change data should reject instead.
 */
export async function isInstanceMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  return (await getInstanceMembership(ctx, instanceId, userId)) !== null;
}

export async function getAccountMembership(ctx: QueryCtx, accountId: Id<"accounts">, userId: Id<"users">) {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_account_user", (q) => q.eq("accountId", accountId).eq("userId", userId))
    .first();
}

/** True if the user may view this account's team data. */
export async function canAccessAccount(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">
): Promise<boolean> {
  const account = await ctx.db.get(accountId);
  if (!account) {
    return false;
  }
  if (account.ownerId === userId) {
    return true;
  }
  const m = await getAccountMembership(ctx, accountId, userId);
  return m !== null;
}

/**
 * Gives the user `role` on the engine, the one way engine access is granted.
 * Holds the membership invariants:
 *
 * - I2: the user joins the engine's org as a `member` when not already in it.
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
 * Only an owner or admin can create an engine, so this covers its creator.
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

export interface TeamMemberDto {
  userId: Id<"users">;
  name: string;
  email: string | null;
  image: string | null;
  orgRole: OrgRole | null;
  engineRole: EngineRole;
  createdAt: number | null;
}

export function toTeamMemberDto(
  user: Doc<"users">,
  membership: Doc<"instanceMembers">,
  orgRole: OrgRole | null
): TeamMemberDto {
  return {
    userId: user._id,
    name: user.name ?? "User",
    email: user.email ?? null,
    image: user.image ?? null,
    orgRole,
    engineRole: membership.role,
    createdAt: membership.createdAt ?? null,
  };
}
