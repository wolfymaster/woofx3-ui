import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const getConfig = query({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    // Verify the user is a member of this instance
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const isMember = membership.some((m) => m.instanceId === args.instanceId);
    if (!isMember) {
      return null;
    }

    // Get the instance to find the engine URL
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      return null;
    }

    if (!instance.clientId || !instance.clientSecret) {
      return null;
    }

    // Call the engine to get storage config
    const engineApi = createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    );

    const config = await engineApi.getStorageConfig();
    return config;
  },
});

export const setConfig = mutation({
  args: {
    instanceId: v.id("instances"),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Verify the user is a member of this instance
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const isMember = membership.some((m) => m.instanceId === args.instanceId);
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }

    // Get the instance to find the engine URL
    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }

    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance not registered with engine");
    }

    // Call the engine to set storage config
    const engineApi = createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    );

    await engineApi.setStorageConfig(args.config as any);

    return { success: true };
  },
});
