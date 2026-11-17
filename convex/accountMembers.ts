import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { removeOrgMember, setOrgMemberRole } from "./org/membership";
import { requireAction } from "./org/policy";

export const removeMember = mutation({
  args: {
    accountId: v.id("accounts"),
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { account } = await requireAction(ctx, { org: args.accountId }, "manageMembers");
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot remove the account owner");
    }
    await removeOrgMember(ctx, args.accountId, args.targetUserId);
  },
});

export const updateMemberRole = mutation({
  args: {
    accountId: v.id("accounts"),
    targetUserId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const { account } = await requireAction(ctx, { org: args.accountId }, "manageMembers");
    if (args.targetUserId === account.ownerId) {
      throw new Error("Cannot change the account owner's role");
    }
    await setOrgMemberRole(ctx, args.accountId, args.targetUserId, args.role);
  },
});
