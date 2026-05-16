import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

export const getForScene = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("obsSceneConfigs")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .first();
    return config;
  },
});

export const upsert = mutation({
  args: {
    sceneId: v.id("scenes"),
    obsHost: v.string(),
    obsPassword: v.optional(v.string()),
    platformActions: v.array(
      v.object({
        trigger: v.string(),
        platform: v.literal("obs"),
        operation: v.object({
          type: v.union(
            v.literal("set_scene"),
            v.literal("set_source_visibility"),
            v.literal("set_filter_enabled"),
            v.literal("set_scene_item_transform"),
            v.literal("play_media"),
            v.literal("set_audio_mute"),
            v.literal("set_audio_volume"),
            v.literal("trigger_hotkey"),
            v.literal("send_vendor_event")
          ),
          target: v.string(),
          params: v.record(v.string(), v.any()),
        }),
        conditions: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("obsSceneConfigs")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .first();

    const now = Date.now();
    const configData = {
      obsHost: args.obsHost,
      obsPassword: args.obsPassword,
      platformActions: args.platformActions,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, configData);
      return existing._id;
    } else {
      const id = await ctx.db.insert("obsSceneConfigs", {
        sceneId: args.sceneId,
        ...configData,
        createdAt: now,
      });
      return id;
    }
  },
});

export const remove = internalMutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query("obsSceneConfigs")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .first();
    if (config) {
      await ctx.db.delete(config._id);
    }
  },
});

export const getForInstance = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();

    const configs: Record<string, {
      obsHost: string;
      obsPassword?: string;
      platformActions: typeof scenes[number][];
    }> = {};

    for (const scene of scenes) {
      const config = await ctx.db
        .query("obsSceneConfigs")
        .withIndex("by_scene", (q) => q.eq("sceneId", scene._id))
        .first();
      if (config) {
        configs[scene._id] = {
          obsHost: config.obsHost,
          obsPassword: config.obsPassword,
          platformActions: config.platformActions as any,
        };
      }
    }

    return configs;
  },
});