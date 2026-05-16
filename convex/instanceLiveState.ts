import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const getForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
  },
});

export const onStreamOnline = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.optional(v.string()),
    twitchUserId: v.string(),
    startedAt: v.string(),
    streamTitle: v.optional(v.string()),
    gameName: v.optional(v.string()),
    viewerCount: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { instanceId, applicationId, twitchUserId, startedAt, streamTitle, gameName, viewerCount },
  ) => {
    const existing = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const patch = {
      instanceId,
      applicationId,
      twitchUserId,
      isLive: true,
      startedAt,
      streamTitle,
      gameName,
      viewerCount,
      lastUpdateSource: "webhook" as const,
      lastUpdatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("instanceLiveState", patch);
    }
  },
});

export const onStreamOffline = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.optional(v.string()),
    twitchUserId: v.string(),
  },
  handler: async (ctx, { instanceId, applicationId, twitchUserId }) => {
    const existing = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const patch = {
      instanceId,
      applicationId,
      twitchUserId,
      isLive: false,
      startedAt: undefined,
      streamTitle: undefined,
      gameName: undefined,
      viewerCount: undefined,
      lastUpdateSource: "webhook" as const,
      lastUpdatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("instanceLiveState", patch);
    }
  },
});
