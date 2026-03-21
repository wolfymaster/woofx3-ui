import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const defaultModules = [
  { id: "chat-1", type: "chat", title: "Chat" },
  { id: "events-1", type: "event-feed", title: "Events" },
  { id: "workflow-runs-1", type: "workflow-runs", title: "Workflow Runs" },
];

export const getLayout = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return defaultModules;

    const layout = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", args.instanceId).eq("userId", userId)
      )
      .first();

    return layout?.modules ?? defaultModules;
  },
});

export const saveLayout = mutation({
  args: {
    instanceId: v.id("instances"),
    modules: v.array(
      v.object({
        id: v.string(),
        type: v.string(),
        title: v.string(),
        config: v.optional(v.any()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("dashboardLayouts")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", args.instanceId).eq("userId", userId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { modules: args.modules });
    } else {
      await ctx.db.insert("dashboardLayouts", {
        instanceId: args.instanceId,
        userId,
        modules: args.modules,
      });
    }
  },
});
