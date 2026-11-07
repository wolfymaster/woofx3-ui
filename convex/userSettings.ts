import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";

async function isMember(ctx: QueryCtx, userId: Id<"users">, instanceId: Id<"instances">): Promise<boolean> {
  // Memberships can outlive a deleted engine.
  if (!(await ctx.db.get(instanceId))) {
    return false;
  }
  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return membership !== null;
}

/**
 * The engine to open on sign-in, or null when none is set. A default the user
 * has since lost access to (or whose engine was deleted) counts as none.
 */
export const getMine = query({
  args: {},
  handler: async (ctx): Promise<{ defaultInstanceId: Id<"instances"> | null } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const instanceId = settings?.defaultInstanceId;
    if (!instanceId || !(await isMember(ctx, userId, instanceId))) {
      return { defaultInstanceId: null };
    }
    return { defaultInstanceId: instanceId };
  },
});

/** Pass null to clear the default. */
export const setDefaultEngine = mutation({
  args: { instanceId: v.union(v.id("instances"), v.null()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    if (args.instanceId && !(await isMember(ctx, userId, args.instanceId))) {
      throw new Error("Not authorized");
    }
    const defaultInstanceId = args.instanceId ?? undefined;
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { defaultInstanceId, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("userSettings", { userId, defaultInstanceId, updatedAt: Date.now() });
    }
  },
});
