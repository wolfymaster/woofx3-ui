import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();

    if (!membership) return null;
    return ctx.db.get(args.instanceId);
  },
});

export const create = mutation({
  args: {
    accountId: v.id("accounts"),
    name: v.string(),
    url: v.string(),
    applicationId: v.string(),
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
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();

    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    const { instanceId, ...updates } = args;
    await ctx.db.patch(instanceId, updates);
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
