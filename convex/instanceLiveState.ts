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
  handler: async (ctx, { instanceId, applicationId, twitchUserId, startedAt, streamTitle, gameName, viewerCount }) => {
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

// Reconciles instanceLiveState from a live engine poll (see streamStatus.ts).
// Exists because the STREAM_ONLINE/OFFLINE webhook path can silently stop
// delivering (EventSub subscription lapses, the engine's twitch listener
// restarts, etc.) and leave this table stuck on a stale event indefinitely.
export const recordPoll = internalMutation({
  args: {
    instanceId: v.id("instances"),
    isLive: v.boolean(),
    twitchUserId: v.optional(v.string()),
    startedAt: v.optional(v.string()),
    streamTitle: v.optional(v.string()),
    gameName: v.optional(v.string()),
    viewerCount: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, isLive, twitchUserId, startedAt, streamTitle, gameName, viewerCount }) => {
    const existing = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    const patch = {
      instanceId,
      applicationId: existing?.applicationId,
      twitchUserId,
      isLive,
      startedAt: isLive ? startedAt : undefined,
      streamTitle: isLive ? streamTitle : undefined,
      gameName: isLive ? gameName : undefined,
      viewerCount: isLive ? viewerCount : undefined,
      lastUpdateSource: "poll" as const,
      lastUpdatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("instanceLiveState", patch);
    }
  },
});

// The engine's resolver owns which session the system is in and announces it
// here. Deliberately not folded into onStreamOnline: a session spans brief
// dropouts, so it changes on a different schedule from the broadcast, and on
// the engine side the two are separate bus subscribers with no ordering
// between them.
//
// Touches only the session fields. isLive and the broadcast columns belong to
// the stream writers, and a session can legitimately start while offline.
export const onSessionStarted = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.optional(v.string()),
    sessionId: v.string(),
    sessionStartedAt: v.string(),
  },
  handler: async (ctx, { instanceId, applicationId, sessionId, sessionStartedAt }) => {
    const existing = await ctx.db
      .query("instanceLiveState")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();

    if (existing) {
      // applicationId is deliberately not patched: a patch carries undefined as
      // a deletion, and the stream writers own that field.
      await ctx.db.patch(existing._id, { sessionId, sessionStartedAt });
      return;
    }

    // No stream event has landed yet, so nothing knows whether we are live.
    await ctx.db.insert("instanceLiveState", {
      instanceId,
      applicationId,
      sessionId,
      sessionStartedAt,
      isLive: false,
      lastUpdateSource: "webhook" as const,
      lastUpdatedAt: Date.now(),
    });
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
