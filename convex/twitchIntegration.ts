import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const upsertPlatformLink = internalMutation({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
    platformUserId: v.string(),
    platformUsername: v.string(),
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

export const syncToEngine = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();

    if (!link) {
      throw new Error("No Twitch platform link found for instance");
    }

    const instance = await ctx.db.get(instanceId);
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
      tokenType: "Bearer" as const,
      scope: link.scopes,
      obtainMethod: "code" as const,
    };

    await engine.setTwitchToken(token, link.connectedByUserId ?? undefined);
  },
});

export const disconnect = mutation({
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

    if (!link) {
      return { ok: true };
    }

    const instance = await ctx.db.get(instanceId);
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

    await ctx.db.delete(link._id);
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
