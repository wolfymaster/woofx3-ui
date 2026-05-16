import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";

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

export const replay = mutation({
  args: {
    instanceId: v.id("instances"),
    alertId: v.id("alertHistory"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Verify the user is a member of this instance
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const isMember = membership.some((m) => m.instanceId === args.instanceId);
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }

    // Get the alert history entry
    const alert = await ctx.db.get(args.alertId);
    if (!alert) {
      throw new Error("Alert not found");
    }

    // Get the instance to find the engine URL
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }

    // Call the engine to replay the alert
    const engineApi = await createEngineRpcSession(
      instance.engineUrl,
      instance.clientId,
      instance.clientSecret
    );

    await engineApi.replayAlert({ id: alert._id });

    return { success: true };
  },
});
