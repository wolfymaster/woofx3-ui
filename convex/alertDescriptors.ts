import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByScene = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const listBySlot = query({
  args: { slotId: v.id("sceneSlots") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alertDescriptors")
      .collect()
      .then((descriptors) => descriptors.filter((d) => d.slotId === args.slotId));
  },
});

export const get = query({
  args: { descriptorId: v.id("alertDescriptors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.descriptorId);
  },
});

export const create = mutation({
  args: {
    sceneId: v.id("scenes"),
    slotId: v.id("sceneSlots"),
    alertTypes: v.array(v.string()),
    priority: v.number(),
    ttl: v.number(),
    duration: v.number(),
    layers: v.array(
      v.object({
        type: v.union(
          v.literal("text"),
          v.literal("image"),
          v.literal("video"),
          v.literal("audio"),
          v.literal("lottie")
        ),
        content: v.string(),
        style: v.record(v.string(), v.string()),
        assetUrl: v.optional(v.string()),
        animationIn: v.optional(v.string()),
        animationOut: v.optional(v.string()),
        volume: v.optional(v.number()),
      })
    ),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const descriptorId = await ctx.db.insert("alertDescriptors", {
      sceneId: args.sceneId,
      slotId: args.slotId,
      alertTypes: args.alertTypes,
      priority: args.priority,
      ttl: args.ttl,
      duration: args.duration,
      layers: args.layers,
      enabled: args.enabled,
      createdAt: now,
      updatedAt: now,
    });

    return descriptorId;
  },
});

export const update = mutation({
  args: {
    descriptorId: v.id("alertDescriptors"),
    alertTypes: v.optional(v.array(v.string())),
    priority: v.optional(v.number()),
    ttl: v.optional(v.number()),
    duration: v.optional(v.number()),
    layers: v.optional(
      v.array(
        v.object({
          type: v.union(
            v.literal("text"),
            v.literal("image"),
            v.literal("video"),
            v.literal("audio"),
            v.literal("lottie")
          ),
          content: v.string(),
          style: v.record(v.string(), v.string()),
          assetUrl: v.optional(v.string()),
          animationIn: v.optional(v.string()),
          animationOut: v.optional(v.string()),
          volume: v.optional(v.number()),
        })
      )
    ),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { descriptorId, ...updates } = args;
    await ctx.db.patch(descriptorId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { descriptorId: v.id("alertDescriptors") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.descriptorId);
  },
});

export const toggleEnabled = mutation({
  args: { descriptorId: v.id("alertDescriptors"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.descriptorId, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
  },
});
