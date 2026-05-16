import { v } from "convex/values";
import {
  query,
  action,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const upsertPlatformLink = internalMutation({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
    platformUserId: v.string(),
    platformUsername: v.string(),
    profileImageUrl: v.optional(v.string()),
    channelId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), args.platform))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("platformLinks", args);
    }
  },
});

export const getLinkAndInstance = internalQuery({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
  },
  handler: async (ctx, { instanceId, platform }) => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), platform))
      .first();
    const instance = await ctx.db.get(instanceId);
    return { link, instance };
  },
});

export const deletePlatformLink = internalMutation({
  args: { linkId: v.id("platformLinks") },
  handler: async (ctx, { linkId }) => {
    await ctx.db.delete(linkId);
  },
});

export const syncToEngine = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const { link, instance } = await ctx.runQuery(internal.twitchIntegration.getLinkAndInstance, {
      instanceId,
      platform: "twitch",
    });

    if (!link) {
      throw new Error("No Twitch platform link found for instance");
    }
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance not registered with engine");
    }

    const engine = createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret,
    );

    const token = {
      userId: link.platformUserId,
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresIn: Math.max(0, Math.floor((link.expiresAt - Date.now()) / 1000)),
      obtainmentTimestamp: Date.now(),
      scope: link.scopes,
    };

    await engine.setTwitchToken(token, link.connectedByUserId ?? undefined);
  },
});

export const disconnect = action({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
  },
  handler: async (ctx, { instanceId, platform }) => {
    const { link, instance } = await ctx.runQuery(internal.twitchIntegration.getLinkAndInstance, {
      instanceId,
      platform,
    });

    if (!link) {
      return { ok: true };
    }

    if (instance?.clientId && instance?.clientSecret) {
      try {
        const engine = createEngineRpcSession<EngineApi>(
          instance.url,
          instance.clientId,
          instance.clientSecret,
        );
        await engine.deleteTwitchToken();
      } catch (err) {
        console.warn("[disconnect] engine.deleteTwitchToken failed (proceeding with local delete)", err);
      }
    }

    await ctx.runMutation(internal.twitchIntegration.deletePlatformLink, { linkId: link._id });
    return { ok: true };
  },
});

export const getStatus = query({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
  },
  handler: async (ctx, { instanceId, platform }) => {
    return ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), platform))
      .first();
  },
});
