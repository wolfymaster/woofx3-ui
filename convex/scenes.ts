import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type QueryCtx, query } from "./_generated/server";
import { parseSceneLayout, parseSceneWidgets } from "./lib/sceneSerialization";

// Scenes are engine-authoritative. The engine is the source of truth; this table
// is a read cache populated exclusively by webhook callbacks (upsertFromWebhook /
// deleteFromWebhook). All UI writes go through convex/sceneActions.ts → engine RPC.
// There are intentionally NO public create/update/delete mutations here — adding
// one would create a second write path that fights the webhook writer.

type SceneCache = Doc<"scenes"> & { id: Id<"scenes">; widgets: unknown[] };

function toSceneCache(scene: Doc<"scenes">): SceneCache {
  return { ...scene, id: scene._id, widgets: scene.widgets ?? [] };
}

async function membershipFor(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<Doc<"instanceMembers"> | null> {
  return await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<SceneCache[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, args.instanceId, userId);
    if (!membership) {
      return [];
    }

    const scenes = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(500);

    return scenes.map(toSceneCache);
  },
});

export const get = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args): Promise<SceneCache | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) {
      return null;
    }

    const membership = await membershipFor(ctx, scene.instanceId, userId);
    if (!membership) {
      return null;
    }

    return toSceneCache(scene);
  },
});

export const getByEngineSceneId = query({
  args: { instanceId: v.id("instances"), engineSceneId: v.string() },
  handler: async (ctx, args): Promise<SceneCache | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const membership = await membershipFor(ctx, args.instanceId, userId);
    if (!membership) {
      return null;
    }

    const scene = await ctx.db
      .query("scenes")
      .withIndex("by_engine_scene_id", (q) =>
        q.eq("instanceId", args.instanceId).eq("engineSceneId", args.engineSceneId)
      )
      .first();

    if (!scene) {
      return null;
    }

    return toSceneCache(scene);
  },
});

export const getBrowserSourceKeys = query({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) {
      return [];
    }

    const membership = await membershipFor(ctx, scene.instanceId, userId);
    if (!membership) {
      return [];
    }

    return await ctx.db
      .query("browserSourceKeys")
      .withIndex("by_scene", (q) => q.eq("sceneId", args.sceneId))
      .collect();
  },
});

// Populated by the engine SCENE_CREATED / SCENE_UPDATED webhook. Keyed on
// engineSceneId (the engine's stable identity) via the by_engine_scene_id index,
// so redelivery is idempotent and renames never create duplicates.
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineSceneId: v.string(),
    name: v.string(),
    description: v.string(),
    widgetsJson: v.string(),
    layoutJson: v.string(),
    createdByType: v.string(),
    createdByRef: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scenes")
      .withIndex("by_engine_scene_id", (q) =>
        q.eq("instanceId", args.instanceId).eq("engineSceneId", args.engineSceneId)
      )
      .first();

    const widgets = parseSceneWidgets(args.widgetsJson);
    const layout = parseSceneLayout(args.layoutJson);

    const fields = {
      instanceId: args.instanceId,
      applicationId: args.applicationId,
      engineSceneId: args.engineSceneId,
      name: args.name,
      description: args.description || undefined,
      width: layout.width ?? 1920,
      height: layout.height ?? 1080,
      backgroundColor: layout.backgroundColor ?? "transparent",
      widgets,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("scenes", { ...fields, createdAt: Date.now() });
    }
  },
});

// Populated by the engine SCENE_DELETED webhook. Deletes the specific scene by
// engineSceneId — never a positional .first(), which could destroy a sibling.
export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineSceneId: v.string(),
  },
  handler: async (ctx, args) => {
    const scene = await ctx.db
      .query("scenes")
      .withIndex("by_engine_scene_id", (q) =>
        q.eq("instanceId", args.instanceId).eq("engineSceneId", args.engineSceneId)
      )
      .first();

    if (scene) {
      await ctx.db.delete(scene._id);
    }
  },
});

export const generateBrowserSourceKey = mutation({
  args: {
    sceneId: v.id("scenes"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const scene = await ctx.db.get(args.sceneId);
    if (!scene) {
      throw new Error("Scene not found");
    }

    const membership = await membershipFor(ctx, scene.instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    const key = `bs_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const keyId = await ctx.db.insert("browserSourceKeys", {
      instanceId: scene.instanceId,
      sceneId: args.sceneId,
      key,
      name: args.name,
      createdAt: Date.now(),
    });

    return { keyId, key };
  },
});
