import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (memberships.length === 0) return [];

    const instanceIds = memberships.map((m) => m.instanceId);
    const scenes = await ctx.db.query("scenes").collect();

    return scenes
      .filter((s) => instanceIds.includes(s.instanceId))
      .map((s) => ({
        ...s,
        id: s._id,
        widgets: s.widgets ?? [],
      }));
  },
});

export const get = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) return null;

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) return null;

    return {
      ...scene,
      id: scene._id,
      widgets: scene.widgets ?? [],
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    backgroundColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const memberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (memberships.length === 0) {
      throw new Error("No instances found");
    }

    const instanceId = memberships[0].instanceId;
    const now = Date.now();

    const sceneId = await ctx.db.insert("scenes", {
      instanceId,
      name: args.name,
      description: args.description,
      width: args.width ?? 1920,
      height: args.height ?? 1080,
      backgroundColor: args.backgroundColor ?? "transparent",
      createdAt: now,
      updatedAt: now,
    });

    return sceneId;
  },
});

export const updateWidgets = mutation({
  args: {
    sceneId: v.id("scenes"),
    widgets: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) throw new Error("Not authorized");

    await ctx.db.patch(args.sceneId, { widgets: args.widgets, updatedAt: Date.now() });
  },
});

export const update = mutation({
  args: {
    sceneId: v.id("scenes"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    backgroundColor: v.optional(v.string()),
    widgets: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) throw new Error("Not authorized");

    const { sceneId, ...updates } = args;
    await ctx.db.patch(sceneId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.sceneId);
  },
});

export const duplicate = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) throw new Error("Scene not found");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) throw new Error("Not authorized");

    const now = Date.now();
    const newSceneId = await ctx.db.insert("scenes", {
      instanceId: scene.instanceId,
      name: `${scene.name} (Copy)`,
      description: scene.description ?? undefined,
      width: scene.width,
      height: scene.height,
      backgroundColor: scene.backgroundColor,
      createdAt: now,
      updatedAt: now,
    });

    return newSceneId;
  },
});
