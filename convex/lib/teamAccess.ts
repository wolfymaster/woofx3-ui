import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getInstanceMembership(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">,
) {
  return ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

export async function getAccountMembership(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
) {
  return ctx.db
    .query("accountMembers")
    .withIndex("by_account_user", (q) => q.eq("accountId", accountId).eq("userId", userId))
    .first();
}

/** True if the user may view this account's team data. */
export async function canAccessAccount(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
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

/** Owner (billing) or account admin/owner membership row may manage invites and members. */
export async function assertCanManageAccountTeam(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
): Promise<{ account: Doc<"accounts"> } | null> {
  const account = await ctx.db.get(accountId);
  if (!account) {
    return null;
  }
  if (account.ownerId === userId) {
    return { account };
  }
  const m = await getAccountMembership(ctx, accountId, userId);
  if (m && (m.role === "admin" || m.role === "owner")) {
    return { account };
  }
  return null;
}

export type AccountTeamRole = "owner" | "admin" | "member";

export function mapInviteRoleToInstanceRole(role: "admin" | "member"): "admin" | "member" {
  return role;
}

export function mapAccountRoleToInstanceRole(role: AccountTeamRole): "owner" | "admin" | "member" {
  return role;
}

/** Ensure instanceMembers row exists for this user on this instance. */
export async function ensureInstanceMember(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">,
  role: "owner" | "admin" | "member",
) {
  const existing = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  if (existing) {
    if (existing.role !== role) {
      await ctx.db.patch(existing._id, { role });
    }
    return;
  }
  await ctx.db.insert("instanceMembers", {
    instanceId,
    userId,
    role,
  });
}

/** Grant instance access for every instance belonging to the account. */
export async function grantInstanceAccessForAccount(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  userId: Id<"users">,
  accountRole: AccountTeamRole,
) {
  const instanceRole = mapAccountRoleToInstanceRole(accountRole);
  const instances = await ctx.db
    .query("instances")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();
  for (const inst of instances) {
    await ensureInstanceMember(ctx, inst._id, userId, instanceRole);
  }
}
