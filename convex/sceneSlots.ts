import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByScene = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sceneSlots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const get = query({
  args: { slotId: v.id("sceneSlots") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.slotId);
  },
});

export const create = mutation({
  args: {
    sceneId: v.id("scenes"),
    name: v.string(),
    positionX: v.number(),
    positionY: v.number(),
    width: v.number(),
    height: v.number(),
    queueMode: v.union(v.literal("stack"), v.literal("concurrent"), v.literal("interrupt")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");

    const slotId = await ctx.db.insert("sceneSlots", {
      sceneId: args.sceneId,
      name: args.name,
      positionX: args.positionX,
      positionY: args.positionY,
      width: args.width,
      height: args.height,
      queueMode: args.queueMode,
      createdAt: Date.now(),
    });

    return slotId;
  },
});

export const update = mutation({
  args: {
    slotId: v.id("sceneSlots"),
    name: v.optional(v.string()),
    positionX: v.optional(v.number()),
    positionY: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    queueMode: v.optional(v.union(v.literal("stack"), v.literal("concurrent"), v.literal("interrupt"))),
  },
  handler: async (ctx, args) => {
    const { slotId, ...updates } = args;
    await ctx.db.patch(slotId, updates);
  },
});

export const remove = mutation({
  args: { slotId: v.id("sceneSlots") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.slotId);
  },
});
