import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { resyncRelayIfBridging } from "./lib/companionEndpoints";
import { requireInstanceRole } from "./lib/instanceAccess";
import { roleSatisfies } from "./lib/instanceRoles";
import { orgRoleOf } from "./lib/orgRoles";
import { getInstanceMembership, grantEngineRole, type TeamMemberDto, toTeamMemberDto } from "./lib/teamAccess";

// An engine's team: who can open this engine and with which engine role. The
// org role only sets floors (lib/teamAccess.ts grantEngineRole), so the owner
// and org admins can't be lowered or removed here; that is an org change.

/** This engine's members with their engine and org roles, or null for a caller who isn't one. */
export const listForEngine = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ members: TeamMemberDto[]; canManage: boolean } | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const own = await getInstanceMembership(ctx, instanceId, userId);
    const instance = await ctx.db.get(instanceId);
    if (own === null || instance === null) {
      return null;
    }
    const account = await ctx.db.get(instance.accountId);
    if (account === null) {
      return null;
    }
    const rows = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const members: TeamMemberDto[] = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      if (user !== null) {
        members.push(toTeamMemberDto(user, row, await orgRoleOf(ctx, account, row.userId)));
      }
    }
    return { members, canManage: roleSatisfies(own.role, "admin") };
  },
});

interface Target {
  account: Doc<"accounts">;
  membership: Doc<"instanceMembers">;
}

/** The target's engine row, after refusing changes the org role forbids. */
async function changeableTarget(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  targetUserId: Id<"users">
): Promise<Target> {
  const instance = await ctx.db.get(instanceId);
  if (instance === null) {
    throw new Error("Engine not found");
  }
  const account = await ctx.db.get(instance.accountId);
  if (account === null) {
    throw new Error(`Engine ${instanceId} belongs to missing org ${instance.accountId}`);
  }
  if (targetUserId === account.ownerId) {
    throw new Error("The organization owner always owns its engines");
  }
  const membership = await getInstanceMembership(ctx, instanceId, targetUserId);
  if (membership === null) {
    throw new Error("That person isn't on this engine");
  }
  return { account, membership };
}

export const setRole = mutation({
  args: {
    instanceId: v.id("instances"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { instanceId, targetUserId, role }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const { account } = await changeableTarget(ctx, instanceId, targetUserId);
    if (role === "member" && (await orgRoleOf(ctx, account, targetUserId)) === "admin") {
      throw new Error("Organization admins are admins on every engine. Change their organization role first");
    }
    await grantEngineRole(ctx, instanceId, targetUserId, role);
    // A companion this member approved bridges only while they are an admin.
    await resyncRelayIfBridging(ctx, instanceId);
  },
});

/** Takes the user off this engine. They stay in the organization, even when it was their last engine. */
export const remove = mutation({
  args: { instanceId: v.id("instances"), targetUserId: v.id("users") },
  handler: async (ctx, { instanceId, targetUserId }) => {
    await requireInstanceRole(ctx, instanceId, "admin");
    const { account, membership } = await changeableTarget(ctx, instanceId, targetUserId);
    if ((await orgRoleOf(ctx, account, targetUserId)) === "admin") {
      throw new Error("Organization admins have every engine. Change their organization role first");
    }
    await ctx.db.delete(membership._id);
    // A companion this member approved stops bridging with their access.
    await resyncRelayIfBridging(ctx, instanceId);
  },
});
