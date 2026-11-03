import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

export const pendingForAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invitations")
      .filter((q) => q.eq(q.field("accountId"), args.accountId))
      .take(50);
  },
});

export const alertsForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    const rows = (await ctx.db.query("engineAlerts").collect()).filter((row) => row.instanceId === args.instanceId);
    return rows.slice(0, 50);
  },
});
