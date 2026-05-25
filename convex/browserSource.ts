import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, mutation } from "./_generated/server";

export const getDefaultScene = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, args) => {
    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId as any))
      .first();
    return scenes;
  },
});

export const getAlertDescriptor = internalQuery({
  args: { sceneId: v.string(), alertType: v.string() },
  handler: async (ctx, args) => {
    const descriptors = await ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId as any))
      .collect();
    // Filter by alertType - matches if array contains the type or "*"
    return (
      descriptors.find((d) => {
        const types = d.alertTypes ?? [];
        return types.includes(args.alertType) || types.includes("*");
      }) ?? null
    );
  },
});

export const createAlert = internalMutation({
  args: {
    instanceId: v.string(),
    sceneId: v.string(),
    sourceKey: v.string(),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    rawPayload: v.any(),
    priority: v.number(),
    ttl: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const alertId = await ctx.db.insert("alerts", {
      instanceId: args.instanceId as any,
      sceneId: args.sceneId as any,
      sourceKey: args.sourceKey,
      alertType: args.alertType,
      user: args.user,
      amount: args.amount,
      message: args.message,
      tier: args.tier,
      rawPayload: args.rawPayload,
      state: "pending",
      priority: args.priority,
      ttl: args.ttl,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
    return alertId;
  },
});

export const getSourceKeyByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

export const getAllBrowserSourceKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("browserSourceKeys").collect();
    return keys.map((k) => ({
      keyPrefix: k.key.substring(0, 8),
      total: keys.length,
      keys: keys.map((k) => k.key.substring(0, 8)),
    }));
  },
});

export const getAllBrowserSourceKeysDebug = internalQuery({
  args: {},
  handler: async (ctx) => {
    const keys = await ctx.db.query("browserSourceKeys").collect();
    return keys.map((k) => ({
      key: k.key,
      sceneId: k.sceneId,
    }));
  },
});

export const updateSourceKeyLastUsed = internalMutation({
  args: { keyId: v.id("browserSourceKeys"), lastUsedAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.keyId, { lastUsedAt: args.lastUsedAt });
  },
});

export const getScene = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sceneId);
  },
});

export const getSceneSlots = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sceneSlots")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const getAlertDescriptorsForScene = internalQuery({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("alertDescriptors")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

export const updateAlertState = internalMutation({
  args: {
    alertId: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("rendering"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("expired")
    ),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = args.alertId as any;
    const existing = await ctx.db.get(id);
    if (!existing) return;

    const updates: Record<string, unknown> = { state: args.state };
    if (args.completedAt) {
      updates.completedAt = args.completedAt;
    }
    if (args.state === "rendering") {
      updates.claimedBy = "browser-source";
    }

    await ctx.db.patch(id, updates);
  },
});

export const getAlert = internalQuery({
  args: { alertId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.alertId as any);
  },
});

export const createAlertHistory = internalMutation({
  args: {
    instanceId: v.string(),
    sceneId: v.string(),
    alertType: v.string(),
    user: v.string(),
    amount: v.optional(v.number()),
    message: v.optional(v.string()),
    tier: v.optional(v.string()),
    state: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("alertHistory", {
      instanceId: args.instanceId as any,
      sceneId: args.sceneId as any,
      alertType: args.alertType,
      user: args.user,
      amount: args.amount,
      message: args.message,
      tier: args.tier,
      state: args.state,
      createdAt: args.createdAt,
    });
  },
});

async function requireSceneMembership(ctx: MutationCtx, sceneId: Id<"scenes">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const scene = await ctx.db.get(sceneId);
  if (!scene) {
    throw new Error("Scene not found");
  }

  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", scene.instanceId).eq("userId", userId))
    .first();

  if (!membership) {
    throw new Error("Not authorized");
  }

  return scene;
}

export const getOrCreateBrowserSourceKey = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await requireSceneMembership(ctx, args.sceneId);

    const existing = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .first();

    if (existing) {
      return existing.key;
    }

    const key = crypto.randomUUID().replace(/-/g, "");

    await ctx.db.insert("browserSourceKeys", {
      instanceId: scene.instanceId,
      sceneId: args.sceneId,
      key,
      name: `${scene.name} Browser Source`,
      createdAt: Date.now(),
    });

    return key;
  },
});

// Revokes every browser-source key for a scene. Any OBS source pointed at an old
// URL immediately stops resolving (the /browser-source/{key} lookup 404s).
export const revokeBrowserSourceKeys = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    await requireSceneMembership(ctx, args.sceneId);

    const keys = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();

    for (const k of keys) {
      await ctx.db.delete(k._id);
    }

    return { revoked: keys.length };
  },
});

// Revokes existing keys and issues a fresh one. Returns the new key so the
// caller can re-copy the URL; old URLs stop working.
export const rotateBrowserSourceKey = mutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const scene = await requireSceneMembership(ctx, args.sceneId);

    const keys = await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();

    for (const k of keys) {
      await ctx.db.delete(k._id);
    }

    const key = crypto.randomUUID().replace(/-/g, "");
    await ctx.db.insert("browserSourceKeys", {
      instanceId: scene.instanceId,
      sceneId: args.sceneId,
      key,
      name: `${scene.name} Browser Source`,
      createdAt: Date.now(),
    });

    return key;
  },
});
