import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  assertCanManageAccountTeam,
  canAccessAccount,
  ensureInstanceMember,
  mapAccountRoleToInstanceRole,
} from "./lib/teamAccess";
import { mutation, query } from "./_generated/server";

export const listForAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const allowed = await canAccessAccount(ctx, args.accountId, userId);
    if (!allowed) return null;

    const account = await ctx.db.get(args.accountId);
    if (!account) return null;

    const rows = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    const members: Array<{
      userId: (typeof rows)[0]["userId"];
      role: (typeof rows)[0]["role"];
      createdAt: number;
      name: string;
      email: string | null;
      image: string | null;
    }> = [];

    const seen = new Set<string>();

    for (const row of rows) {
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      const u = user as Record<string, unknown>;
      members.push({
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt,
        name: (typeof u.name === "string" ? u.name : null) ?? "User",
        email: typeof u.email === "string" ? u.email : null,
        image: typeof u.image === "string" ? u.image : null,
      });
      seen.add(row.userId);
    }

    if (!seen.has(account.ownerId)) {
      const ownerUser = await ctx.db.get(account.ownerId);
      if (ownerUser) {
        const u = ownerUser as Record<string, unknown>;
        members.push({
          userId: account.ownerId,
          role: "owner",
          createdAt: account.createdAt,
          name: (typeof u.name === "string" ? u.name : null) ?? "User",
          email: typeof u.email === "string" ? u.email : null,
          image: typeof u.image === "string" ? u.image : null,
        });
      }
    }

    const manager = await assertCanManageAccountTeam(ctx, args.accountId, userId);

    return {
      account: { _id: account._id, name: account.name, ownerId: account.ownerId },
      members,
      canManage: manager !== null,
    };
  },
});

export const removeMember = mutation({
  args: {
    accountId: v.id("accounts"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const gate = await assertCanManageAccountTeam(ctx, args.accountId, userId);
    if (!gate) throw new Error("Not authorized");

    const account = gate.account;
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot remove the account owner");
    }

    const row = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) =>
        q.eq("accountId", args.accountId).eq("userId", args.targetUserId),
      )
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
        .withIndex("by_instance_user", (q) =>
          q.eq("instanceId", inst._id).eq("userId", args.targetUserId),
        )
        .first();
      if (im) {
        await ctx.db.delete(im._id);
      }
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const gate = await assertCanManageAccountTeam(ctx, args.accountId, userId);
    if (!gate) throw new Error("Not authorized");

    const account = gate.account;
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot change the account owner's role");
    }

    const row = await ctx.db
      .query("accountMembers")
      .withIndex("by_account_user", (q) =>
        q.eq("accountId", args.accountId).eq("userId", args.targetUserId),
      )
      .first();

    if (!row) throw new Error("Member not found");
    if (row.role === "owner") {
      throw new Error("Cannot demote an owner membership row");
    }

    await ctx.db.patch(row._id, { role: args.role });

    const instanceRole = mapAccountRoleToInstanceRole(args.role);
    const instances = await ctx.db
      .query("instances")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    for (const inst of instances) {
      await ensureInstanceMember(ctx, inst._id, args.targetUserId, instanceRole);
    }
  },
});
