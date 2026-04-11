import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { ensureInstanceMember, mapAccountRoleToInstanceRole } from "./lib/teamAccess";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

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
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", args.instanceId).eq("userId", userId),
      )
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
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", args.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const { instanceId, ...updates } = args;
    await ctx.db.patch(instanceId, updates);
  },
});

/**
 * Internal query to look up the application record for an instance.
 * Returns the first (currently only) application for the given instance.
 */
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
    applicationId: v.string(),
    webhookSecret: v.string(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, applicationId, webhookSecret, apiKey }) => {
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      throw new Error("Instance not found");
    }

    const patch: Record<string, unknown> = { applicationId, webhookSecret };
    if (apiKey !== undefined) {
      patch.apiKey = apiKey;
    }
    await ctx.db.patch(instanceId, patch);

    // Also create/upsert an application record in the applications table
    const existing = await ctx.db
      .query("applications")
      .withIndex("by_instance_app", (q) =>
        q.eq("instanceId", instanceId).eq("applicationId", applicationId),
      )
      .first();

    if (!existing) {
      await ctx.db.insert("applications", {
        instanceId,
        applicationId,
        name: "Default",
        createdAt: Date.now(),
      });
    }
  },
});
