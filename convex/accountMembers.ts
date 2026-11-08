import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { resyncRelayIfBridging } from "./lib/companionEndpoints";
import { requireOrgAction } from "./lib/orgRoles";
import { applyOrgRoleToEngines } from "./lib/teamAccess";

export const removeMember = mutation({
  args: {
    accountId: v.id("accounts"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { account } = await requireOrgAction(ctx, args.accountId, "manageMembers");
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot remove the account owner");
    }

    const row = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", args.accountId).eq("userId", args.targetUserId))
      .first();

    if (!row) throw new Error("Member not found");

    await ctx.db.delete(row._id);

    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    for (const inst of instances) {
      const im = await ctx.db
        .query("instanceMembers")
        .withIndex("by_instance_user", (q) => q.eq("instanceId", inst._id).eq("userId", args.targetUserId))
        .first();
      if (im) {
        await ctx.db.delete(im._id);
      }
      // A companion this member approved stops bridging with their access.
      await resyncRelayIfBridging(ctx, inst._id);
    }
  },
});

export const updateMemberRole = mutation({
  args: {
    accountId: v.id("accounts"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { account } = await requireOrgAction(ctx, args.accountId, "manageMembers");
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot change the account owner's role");
    }

    const row = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) => q.eq("accountId", args.accountId).eq("userId", args.targetUserId))
      .first();

    if (!row) throw new Error("Member not found");
    if (row.role === "owner") {
      throw new Error("Cannot demote an owner membership row");
    }

    await ctx.db.patch(row._id, { role: args.role });

    // A companion this member approved bridges only while they are an engine admin.
    for (const instanceId of await applyOrgRoleToEngines(ctx, args.accountId, args.targetUserId, args.role)) {
      await resyncRelayIfBridging(ctx, instanceId);
    }
  },
});
