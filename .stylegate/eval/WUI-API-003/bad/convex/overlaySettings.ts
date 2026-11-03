import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getOverlaySettings = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const row = await ctx.db
      .query("overlaySettings")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    return row ? { publicUrl: row.publicUrl, theme: row.theme } : null;
  },
});

export const setOverlayTheme = mutation({
  args: { instanceId: v.id("instances"), theme: v.union(v.literal("dark"), v.literal("light")) },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("overlaySettings")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .unique();
    if (!row) {
      throw new Error("No overlay settings for this instance");
    }
    await ctx.db.patch(row._id, { theme: args.theme });
  },
});
