import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

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

export const getBrowserSourceKeys = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) return [];

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", scene.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) return [];

    return await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
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

export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineSceneId: v.string(),
    name: v.string(),
    description: v.string(),
    widgetsJson: v.string(),
    layoutJson: v.string(),
    createdByType: v.string(),
    createdByRef: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    const widgets = JSON.parse(args.widgetsJson || "[]");
    const layout = JSON.parse(args.layoutJson || "{}");

    if (existing) {
      await ctx.db.patch(existing._id, {
        applicationId: args.applicationId,
        name: args.name,
        description: args.description || undefined,
        width: layout.width ?? 1920,
        height: layout.height ?? 1080,
        backgroundColor: layout.backgroundColor ?? "transparent",
        widgets,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("scenes", {
        instanceId: args.instanceId,
        applicationId: args.applicationId,
        name: args.name,
        description: args.description || undefined,
        width: layout.width ?? 1920,
        height: layout.height ?? 1080,
        backgroundColor: layout.backgroundColor ?? "transparent",
        widgets,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
});

export const generateBrowserSourceKey = mutation({
  args: {
    sceneId: v.id("scenes"),
    name: v.string(),
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

    const key = `bs_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const keyId = await ctx.db.insert("browserSourceKeys", {
      instanceId: scene.instanceId,
      sceneId: args.sceneId,
      key,
      name: args.name,
      createdAt: Date.now(),
    });

    return { keyId, key };
  },
});

export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineSceneId: v.string(),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();

    if (scene) {
      await ctx.db.delete(scene._id);
    }
  },
});
