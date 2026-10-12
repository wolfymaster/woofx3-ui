import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";
import { deleteAlertCompositionRow, upsertAlertComposition } from "./alertCompositions";
import { deleteSceneAndChildren, purgeSceneChildren } from "./lib/sceneCascade";
import {
  parseCompositionKind,
  parseSceneLayout,
  parseSceneWidgets,
  tablesForDeletedComposition,
} from "./lib/sceneSerialization";

// Scenes are engine-authoritative. The engine is the source of truth; this table
// is a read cache populated exclusively by webhook callbacks (upsertFromWebhook /
// deleteFromWebhook). All UI writes go through convex/sceneActions.ts → engine RPC.
// There are intentionally NO public create/update/delete mutations here — adding
// one would create a second write path that fights the webhook writer.
//
// The engine's scene webhooks also report alert compositions (`kind: "alert"`).
// Those are routed to the `alertCompositions` table, so this table, and every
// listing and getter below, holds scenes only.

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

async function findScene(ctx: QueryCtx, instanceId: Id<"instances">, engineSceneId: string) {
  return await ctx.db
    .query("scenes")
    .withIndex("by_engine_scene_id", (q) => q.eq("instanceId", instanceId).eq("engineSceneId", engineSceneId))
    .first();
}

// Populated by the engine SCENE_CREATED / SCENE_UPDATED webhook. Keyed on
// engineSceneId (the engine's stable identity) via the by_engine_scene_id index,
// so redelivery is idempotent and renames never create duplicates. An alert
// goes to `alertCompositions`; a scene row under its id (cached before alerts
// were told apart) is removed, since a row's kind never changes.
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineSceneId: v.string(),
    /** `scene` or `alert`; absent from an engine that predates alert compositions. */
    kind: v.optional(v.string()),
    name: v.string(),
    description: v.string(),
    widgetsJson: v.string(),
    layoutJson: v.string(),
    behaviorsJson: v.optional(v.string()),
    inputsJson: v.optional(v.string()),
    createdByType: v.string(),
    createdByRef: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await findScene(ctx, args.instanceId, args.engineSceneId);

    if (parseCompositionKind(args.kind) === "alert") {
      if (existing) {
        await deleteSceneAndChildren(ctx, existing._id);
      }
      await upsertAlertComposition(ctx, args.instanceId, {
        engineCompositionId: args.engineSceneId,
        name: args.name,
        description: args.description,
        widgetsJson: args.widgetsJson,
        layoutJson: args.layoutJson,
        behaviorsJson: args.behaviorsJson,
        inputsJson: args.inputsJson,
        createdByType: args.createdByType,
        createdByRef: args.createdByRef,
      });
      return;
    }

    const widgets = parseSceneWidgets(args.widgetsJson);
    const layout = parseSceneLayout(args.layoutJson);

    const fields = {
      instanceId: args.instanceId,
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
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tables = tablesForDeletedComposition(args.kind);
    if (tables.includes("alertCompositions")) {
      await deleteAlertCompositionRow(ctx, args.instanceId, args.engineSceneId);
    }
    if (!tables.includes("scenes")) {
      return;
    }
    const scene = await findScene(ctx, args.instanceId, args.engineSceneId);
    if (scene) {
      await deleteSceneAndChildren(ctx, scene._id);
    }
  },
});

// Continuation of a cascade that exceeded its per-transaction budget. Reschedules
// itself until every child row of the (already deleted) scene is gone.
export const cascadeSceneChildren = internalMutation({
  args: { sceneId: v.id("scenes") },
  handler: async (ctx, args) => {
    const { done } = await purgeSceneChildren(ctx, args.sceneId);
    if (!done) {
      await ctx.scheduler.runAfter(0, internal.scenes.cascadeSceneChildren, { sceneId: args.sceneId });
    }
  },
});
