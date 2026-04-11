import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";

export const list = query({
  args: {
    instanceId: v.id("instances"),
    alertType: v.optional(v.string()),
    user: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    // Verify the user is a member of this instance
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const isMember = membership.some((m) => m.instanceId === args.instanceId);
    if (!isMember) {
      return [];
    }

    let alerts = await ctx.db
      .query("alertHistory")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .order("desc")
      .take(200);

    if (args.alertType) {
      alerts = alerts.filter((a) => a.alertType === args.alertType);
    }

    if (args.user) {
      const search = args.user.toLowerCase();
      alerts = alerts.filter((a) => a.user.toLowerCase().includes(search));
    }

    return alerts;
  },
});
