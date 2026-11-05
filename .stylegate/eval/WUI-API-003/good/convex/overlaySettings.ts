import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";
import { getInstanceMembership } from "./lib/teamAccess";

async function canRead(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  return (await getInstanceMembership(ctx, instanceId, userId)) !== null;
}

export const getOverlaySettings = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    if (!(await canRead(ctx, args.instanceId))) {
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
    await requireInstanceRole(ctx, args.instanceId, "admin");
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
