import { getAuthUserId } from "@convex-dev/auth/server";
import {
  parseCompositionInputs,
  parseSceneBehaviors,
  parseSceneLayout,
  parseSceneWidgets,
} from "@shared/scene-serialization";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import { escapeDollarKeys } from "./lib/dollarKeys";

// Alert compositions are engine-authoritative, like scenes: this table is a
// read cache written by the `scene.*` webhooks that carry `kind: "alert"`
// (routed here from scenes.upsertFromWebhook / deleteFromWebhook) and by
// `alertCompositionActions.refresh`. Every change goes through
// convex/alertCompositionActions.ts to the engine, whose webhook writes it back.

/** The fields a webhook snapshot or an engine listing gives for one alert. */
export interface AlertCompositionSnapshot {
  engineCompositionId: string;
  name: string;
  description: string;
  widgetsJson: string;
  layoutJson: string;
  behaviorsJson?: string;
  inputsJson?: string;
  createdByType?: string;
  createdByRef?: string;
}

export const alertCompositionSnapshotFields = {
  engineCompositionId: v.string(),
  name: v.string(),
  description: v.string(),
  widgetsJson: v.string(),
  layoutJson: v.string(),
  behaviorsJson: v.optional(v.string()),
  inputsJson: v.optional(v.string()),
  createdByType: v.optional(v.string()),
  createdByRef: v.optional(v.string()),
};

async function isMember(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  const membership = await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
  return membership !== null;
}

async function findRow(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  engineCompositionId: string
): Promise<Doc<"alertCompositions"> | null> {
  return await ctx.db
    .query("alertCompositions")
    .withIndex("by_engine_composition_id", (q) =>
      q.eq("instanceId", instanceId).eq("engineCompositionId", engineCompositionId)
    )
    .first();
}

/** The instance's alert library, by name. */
export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<Doc<"alertCompositions">[]> => {
    if (!(await isMember(ctx, args.instanceId))) {
      return [];
    }
    const rows = await ctx.db
      .query("alertCompositions")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(500);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** One alert by the engine's id; null while its webhook has not arrived, or once it is deleted. */
export const getByEngineId = query({
  args: { instanceId: v.id("instances"), engineCompositionId: v.string() },
  handler: async (ctx, args): Promise<Doc<"alertCompositions"> | null> => {
    if (!(await isMember(ctx, args.instanceId))) {
      return null;
    }
    return await findRow(ctx, args.instanceId, args.engineCompositionId);
  },
});

/** Writes one alert's snapshot, keyed on the engine's id so a redelivered webhook changes nothing. */
export async function upsertAlertComposition(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  snapshot: AlertCompositionSnapshot
): Promise<void> {
  const existing = await findRow(ctx, instanceId, snapshot.engineCompositionId);
  const fields = {
    instanceId,
    engineCompositionId: snapshot.engineCompositionId,
    name: snapshot.name,
    description: snapshot.description || undefined,
    // An alert refers to its inputs as `{ "$input": id }`, a key Convex refuses.
    widgets: escapeDollarKeys(parseSceneWidgets(snapshot.widgetsJson)) as unknown[],
    layout: escapeDollarKeys(parseSceneLayout(snapshot.layoutJson)),
    behaviors: escapeDollarKeys(parseSceneBehaviors(snapshot.behaviorsJson)),
    inputs: escapeDollarKeys(parseCompositionInputs(snapshot.inputsJson)) as unknown[],
    createdByType: snapshot.createdByType,
    createdByRef: snapshot.createdByRef,
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("alertCompositions", { ...fields, createdAt: Date.now() });
  }
}

export async function deleteAlertCompositionRow(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  engineCompositionId: string
): Promise<void> {
  const existing = await findRow(ctx, instanceId, engineCompositionId);
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

/**
 * The engine's whole library, from `listAlertCompositions`: every alert is
 * written, and a cached one the engine no longer has is removed. Catches up
 * a cache that missed webhooks, such as alerts made before this dashboard
 * cached them.
 */
export const reconcileFromEngine = internalMutation({
  args: {
    instanceId: v.id("instances"),
    compositions: v.array(v.object(alertCompositionSnapshotFields)),
  },
  handler: async (ctx, { instanceId, compositions }) => {
    for (const snapshot of compositions) {
      await upsertAlertComposition(ctx, instanceId, snapshot);
    }
    const live = new Set(compositions.map((snapshot) => snapshot.engineCompositionId));
    const cached = await ctx.db
      .query("alertCompositions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(1000);
    for (const row of cached) {
      if (!live.has(row.engineCompositionId)) {
        await ctx.db.delete(row._id);
      }
    }
  },
});
