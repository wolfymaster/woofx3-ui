import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";

// Instance-scoped widget catalog for the scene editor's widget bar. Mirrors the
// workflow catalog pattern: read the per-instance `instanceWidgets` join, then
// look up each widget's definition in the global `moduleWidgets` catalog. The
// query only ever filters by instanceId — widgets are never gated on a module.
export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Doc<"moduleWidgets">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .first();
    if (!membership) {
      return [];
    }

    const rows = await ctx.db
      .query("instanceWidgets")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const widgets: Doc<"moduleWidgets">[] = [];
    for (const row of rows) {
      const def = await ctx.db
        .query("moduleWidgets")
        .withIndex("by_widget_id", (q) => q.eq("widgetId", row.widgetId))
        .first();
      if (def) {
        widgets.push(def);
      }
    }
    return widgets;
  },
});
