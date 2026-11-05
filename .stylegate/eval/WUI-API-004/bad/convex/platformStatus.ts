import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

export const twitchLink = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    return await ctx.db
      .query("twitchPendingAuth")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
  },
});

export const instanceForMember = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    return await ctx.db.get(args.instanceId);
  },
});
