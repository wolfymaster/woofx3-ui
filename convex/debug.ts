import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const sendTestEvent = mutation({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    payload: v.record(v.string(), v.any()),
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

    // Store in debug event history
    await ctx.db.insert("debugEventHistory", {
      userId,
      instanceId: args.instanceId,
      eventType: args.eventType,
      payload: args.payload,
      sentAt: Date.now(),
      success: true,
    });

    return { success: true };
  },
});
