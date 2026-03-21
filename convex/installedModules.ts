import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const installed = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();

    // Join with moduleRepository to get full module details
    return Promise.all(
      installed.map(async (im) => {
        const module = await ctx.db.get(im.moduleId);
        return { ...im, module };
      })
    );
  },
});

export const install = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if already installed
    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("moduleId"), args.moduleId))
      .first();

    if (existing) throw new Error("Module already installed");

    return ctx.db.insert("installedModules", {
      instanceId: args.instanceId,
      moduleId: args.moduleId,
      enabled: true,
      installedAt: Date.now(),
    });
  },
});

export const uninstall = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("moduleId"), args.moduleId))
      .first();

    if (!existing) return;
    await ctx.db.delete(existing._id);
  },
});

export const setEnabled = mutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("moduleId"), args.moduleId))
      .first();

    if (!existing) throw new Error("Module not installed");
    await ctx.db.patch(existing._id, { enabled: args.enabled });
  },
});
