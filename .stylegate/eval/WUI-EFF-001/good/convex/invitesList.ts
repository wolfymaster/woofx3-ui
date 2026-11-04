import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

export const pendingForAccount = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("invitations")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .take(50);
  },
});

export const alertsForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    const rows = await ctx.db
      .query("engineAlerts")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(200);
    return rows.filter((row) => row.status !== "dismissed").slice(0, 50);
  },
});
