import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { createEngineRpcSession, type RpcTarget } from "./lib/engineInstanceUrl";
import { ensureInstanceMember, mapAccountRoleToInstanceRole } from "./lib/teamAccess";

/** Engine RPC surface for instance CRUD (see woofx3 api/src/api.ts). */
interface InstanceEngineRpc extends RpcTarget {
  deleteInstance(params: { instanceName: string }): Promise<unknown>;
}

export const listForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const memberships = await ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const instances = await Promise.all(memberships.map((m) => ctx.db.get(m.instanceId)));
    return instances.filter(Boolean);
  },
});

export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Verify user has access
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (!membership) return null;
    return ctx.db.get(args.instanceId);
  },
});

/**
 * Internal query for server-side lookups (e.g. registration action).
 * No auth check — only callable from other Convex functions.
 */
export const getInternal = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db.get(instanceId);
  },
});

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns this account
    const account = await ctx.db.get(args.accountId);
    if (!account || account.ownerId !== userId) {
      throw new Error("Not authorized");
    }

    const instanceId = await ctx.db.insert("instances", {
      ...args,
      createdAt: Date.now(),
    });

    // Add creator as owner member
    await ctx.db.insert("instanceMembers", {
      instanceId,
      userId,
      role: "owner",
    });

    const teammates = await ctx.db
      .query("accountMembers")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();

    for (const m of teammates) {
      if (m.userId === userId) {
        continue;
      }
      await ensureInstanceMember(ctx, instanceId, m.userId, mapAccountRoleToInstanceRole(m.role));
    }

    return instanceId;
  },
});

export const update = mutation({
  args: {
    instanceId: v.id("instances"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", userId))
      .first();

    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const { instanceId, ...updates } = args;
    await ctx.db.patch(instanceId, updates);
  },
});

export const deleteInstance = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId: args.instanceId, userId });
    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: args.instanceId });
    if (!instance) throw new Error("Instance not found");

    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const engine = createEngineRpcSession<InstanceEngineRpc>(instance.url, instance.clientId, instance.clientSecret);
    await engine.deleteInstance({ instanceName: instance.name });

    await ctx.runMutation(internal.instances.deleteInstanceData, { instanceId: args.instanceId });
  },
});

export const getMembership = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    return ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
      .first();
  },
});

export const deleteInstanceData = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const applications = await ctx.db
      .query("applications")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const app of applications) {
      await ctx.db.delete(app._id);
    }

    const platformLinks = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const link of platformLinks) {
      await ctx.db.delete(link._id);
    }

    const instanceMembers = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const member of instanceMembers) {
      await ctx.db.delete(member._id);
    }

    await ctx.db.delete(instanceId);
  },
});

export const getApplicationForInstance = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("applications")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
  },
});

export const getPlatformLinks = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .collect();
  },
});

export const savePlatformLink = mutation({
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Upsert: replace existing link for this platform on this instance
    const existing = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), args.platform))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return ctx.db.insert("platformLinks", args);
  },
});

/**
 * Internal mutation used by the registration action to persist handshake results.
 * Not exposed to clients.
 */
export const applyRegistration = internalMutation({
  args: {
    instanceId: v.id("instances"),
    clientId: v.string(),
    clientSecret: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, { instanceId, clientId, clientSecret, webhookSecret }) => {
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }

    await ctx.db.patch(instanceId, { clientId, clientSecret, webhookSecret });
  },
});

/**
 * Internal query to look up an instance by its webhook secret (callbackToken).
 * Used by the /api/webhooks/woofx3 endpoint for Bearer token auth.
 */
export const getByWebhookSecret = internalQuery({
  args: { webhookSecret: v.string() },
  handler: async (ctx, { webhookSecret }) => {
    return ctx.db
      .query("instances")
      .withIndex("by_webhook_secret", (q) => q.eq("webhookSecret", webhookSecret))
      .first();
  },
});
