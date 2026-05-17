import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ENGINE_SYNC_CONFIG,
  computeNextEligibleAt,
  computeNextEligibleAtAfterError,
} from "./lib/engineSync/config";

// One-shot cleanup for the orphan instanceSync rows that exist in the
// pre-spec deployment. Safe to delete after the first prod deploy.
export const dropAllInstanceSync = internalMutation({
  args: {},
  handler: async (ctx) => {
    // One-shot cleanup. Orphan count is small (3 in dev as of writing) — take
    // a generous ceiling that's still well under Convex read limits.
    const rows = await ctx.db.query("instanceSync").take(100);
    for (const r of rows) {
      await ctx.db.delete(r._id);
    }
    return rows.length;
  },
});

/**
 * Reconcile the local `chatCommands` mirror against a full snapshot
 * returned by the engine's `listCommands()`. The engine is the source of
 * truth: rows whose `engineCommandId` is present in the snapshot are
 * upserted; rows with an `engineCommandId` that no longer appears are
 * deleted. Rows that have no `engineCommandId` at all (locally-created
 * but never pushed to the engine) are left alone.
 *
 * The engine's `CommandSnapshot` (see `@woofx3/api`) carries the
 * type-discriminated payload in a single `typeValue` string. The legacy
 * Convex-side fields `response` / `template` / `functionId` are not
 * sourced from the engine and are not touched by this reconciler.
 */
export const reconcileCommands = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    snapshots: v.array(
      v.object({
        engineCommandId: v.string(),
        command: v.string(),
        type: v.union(v.literal("static"), v.literal("dynamic"), v.literal("function")),
        typeValue: v.string(),
        cooldown: v.number(),
        priority: v.number(),
        enabled: v.boolean(),
      })
    ),
  },
  handler: async (ctx, { instanceId, applicationId, snapshots }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("chatCommands")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const existingByEngineId = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      if (row.engineCommandId) {
        existingByEngineId.set(row.engineCommandId, row);
      }
    }

    const snapshotIds = new Set(snapshots.map((s) => s.engineCommandId));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByEngineId.get(snap.engineCommandId);
      if (found) {
        await ctx.db.patch(found._id, {
          applicationId,
          command: snap.command,
          type: snap.type,
          typeValue: snap.typeValue,
          cooldown: snap.cooldown,
          priority: snap.priority,
          enabled: snap.enabled,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("chatCommands", {
          instanceId,
          applicationId,
          engineCommandId: snap.engineCommandId,
          command: snap.command,
          type: snap.type,
          typeValue: snap.typeValue,
          cooldown: snap.cooldown,
          priority: snap.priority,
          enabled: snap.enabled,
          createdAt: now,
          updatedAt: now,
        });
      }
      processed++;
    }

    // Delete rows whose engineCommandId disappeared from the engine.
    // Rows with no engineCommandId (locally-created, never pushed) are skipped.
    for (const row of existing) {
      if (row.engineCommandId && !snapshotIds.has(row.engineCommandId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the local `installedModules` mirror against a full snapshot
 * returned by the engine's `listEngineModules()`. The engine is the source
 * of truth: rows whose `name` is present in the snapshot are upserted;
 * rows with a `name` that no longer appears are deleted.
 */
export const reconcileModules = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        name: v.string(),
        version: v.string(),
        state: v.string(),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("installedModules")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const existingByName = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      existingByName.set(row.name, row);
    }

    const snapshotNames = new Set(snapshots.map((s) => s.name));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByName.get(snap.name);
      if (found) {
        if (found.version !== snap.version || found.state !== snap.state) {
          await ctx.db.patch(found._id, {
            version: snap.version,
            state: snap.state,
            updatedAt: now,
          });
        }
      } else {
        await ctx.db.insert("installedModules", {
          instanceId,
          name: snap.name,
          version: snap.version,
          state: snap.state,
          updatedAt: now,
        });
      }
      processed++;
    }

    for (const row of existing) {
      if (!snapshotNames.has(row.name)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the local `workflows` mirror against a full snapshot returned
 * by the engine's `getWorkflows()` (paginated). The engine is the source
 * of truth: rows whose `engineWorkflowId` is present in `engineIds` are
 * upserted with the supplied definition/isEnabled; rows with an
 * `engineWorkflowId` that no longer appears are deleted.
 *
 * `engineIds` is passed separately from `upserts` so the caller can
 * declare the full live set even when only a subset is being upserted.
 * In practice they match, but keeping the parameter explicit avoids
 * coupling the deletion check to upsert iteration.
 */
export const reconcileWorkflows = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineIds: v.array(v.string()),
    upserts: v.array(
      v.object({
        engineWorkflowId: v.string(),
        definition: v.any(),
        isEnabled: v.boolean(),
      })
    ),
  },
  handler: async (ctx, { instanceId, applicationId, engineIds, upserts }) => {
    const now = Date.now();

    for (const u of upserts) {
      const existing = await ctx.db
        .query("workflows")
        .withIndex("by_engine_id", (q) =>
          q.eq("instanceId", instanceId).eq("engineWorkflowId", u.engineWorkflowId)
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          applicationId,
          definition: u.definition,
          isEnabled: u.isEnabled,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("workflows", {
          instanceId,
          applicationId,
          engineWorkflowId: u.engineWorkflowId,
          definition: u.definition,
          isEnabled: u.isEnabled,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const liveIds = new Set(engineIds);
    const local = await ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of local) {
      if (!liveIds.has(row.engineWorkflowId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: upserts.length };
  },
});

/**
 * Reconcile the local `scenes` mirror against a full snapshot returned by
 * the engine's `getScenes()` (paginated). The engine is the source of
 * truth: rows whose `engineSceneId` is present in `engineIds` are upserted
 * with the supplied fields; rows with an `engineSceneId` that no longer
 * appears are deleted. Legacy rows without an `engineSceneId` (created via
 * the older webhook path that keyed by name) are left alone.
 *
 * The engine's `Scene` shape (see `@woofx3/api`) is minimal: `id`, `name`,
 * `accountId`, `widgets`, `createdAt`. Convex stores additional UI-only
 * fields (description, layout dimensions, sceneWidgets) that are populated
 * via webhooks; this reconciler does not touch those fields and only
 * patches what the engine actually returns.
 */
export const reconcileScenes = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineIds: v.array(v.string()),
    upserts: v.array(
      v.object({
        engineSceneId: v.string(),
        name: v.string(),
        widgets: v.optional(v.array(v.any())),
      })
    ),
  },
  handler: async (ctx, { instanceId, applicationId, engineIds, upserts }) => {
    const now = Date.now();

    for (const u of upserts) {
      const existing = await ctx.db
        .query("scenes")
        .withIndex("by_engine_scene_id", (q) =>
          q.eq("instanceId", instanceId).eq("engineSceneId", u.engineSceneId)
        )
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          applicationId,
          name: u.name,
          widgets: u.widgets,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("scenes", {
          instanceId,
          applicationId,
          engineSceneId: u.engineSceneId,
          name: u.name,
          widgets: u.widgets,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const liveIds = new Set(engineIds);
    const local = await ctx.db
      .query("scenes")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of local) {
      if (row.engineSceneId && !liveIds.has(row.engineSceneId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: upserts.length };
  },
});

/** Fetch the instance bundle needed to open a capnweb session. */
export const getInstanceBundle = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const inst = await ctx.db.get(instanceId);
    if (!inst) {
      return null;
    }
    if (!inst.clientId || !inst.clientSecret || !inst.applicationId) {
      return null;
    }
    return {
      url: inst.url,
      clientId: inst.clientId,
      clientSecret: inst.clientSecret,
      applicationId: inst.applicationId,
      lastEngineActivityAt: inst.lastEngineActivityAt ?? 0,
    };
  },
});

/** Ensure an instanceSync row exists for this instance; return it. */
export const ensureInstanceSyncRow = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Doc<"instanceSync">> => {
    const existing = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (existing) {
      return existing;
    }
    const now = Date.now();
    const id = await ctx.db.insert("instanceSync", {
      instanceId,
      lastSyncedAt: 0,
      nextEligibleAt: now,
      status: "idle",
      lastError: "",
      lastDurationMs: 0,
      consecutiveErrorCount: 0,
      syncIntervalMs: ENGINE_SYNC_CONFIG.defaultSyncIntervalMs,
    });
    const row = await ctx.db.get(id);
    if (!row) {
      throw new Error("ensureInstanceSyncRow: insert lost");
    }
    return row;
  },
});

/** Start a syncRuns row in "running" state and mark instanceSync.status="running". */
export const startRun = internalMutation({
  args: {
    instanceId: v.id("instances"),
    trigger: v.union(v.literal("scheduled"), v.literal("manual")),
  },
  handler: async (ctx, { instanceId, trigger }): Promise<Id<"syncRuns">> => {
    const now = Date.now();
    const sync = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (sync) {
      await ctx.db.patch(sync._id, { status: "running", lastError: "" });
    }
    return ctx.db.insert("syncRuns", {
      instanceId,
      trigger,
      status: "running",
      startedAt: now,
      steps: [
        { name: "commands", status: "pending", itemsProcessed: 0 },
        { name: "modules", status: "pending", itemsProcessed: 0 },
        { name: "workflows", status: "pending", itemsProcessed: 0 },
        { name: "scenes", status: "pending", itemsProcessed: 0 },
      ],
    });
  },
});

export const updateRunStep = internalMutation({
  args: {
    runId: v.id("syncRuns"),
    stepName: v.union(
      v.literal("commands"),
      v.literal("modules"),
      v.literal("workflows"),
      v.literal("scenes"),
    ),
    patch: v.object({
      status: v.optional(
        v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("error"))
      ),
      itemsProcessed: v.optional(v.number()),
      error: v.optional(v.string()),
      startedAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { runId, stepName, patch }) => {
    const run = await ctx.db.get(runId);
    if (!run) {
      return;
    }
    const steps = run.steps.map((s) => (s.name === stepName ? { ...s, ...patch } : s));
    await ctx.db.patch(runId, { steps });
  },
});

/** Finalize a run: set syncRuns terminal status + update instanceSync. */
export const finalizeRun = internalMutation({
  args: {
    runId: v.id("syncRuns"),
    instanceId: v.id("instances"),
    status: v.union(v.literal("success"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { runId, instanceId, status, error }) => {
    const now = Date.now();
    const run = await ctx.db.get(runId);
    if (!run) {
      return;
    }
    await ctx.db.patch(runId, {
      status,
      completedAt: now,
      error: error ?? undefined,
    });

    const sync = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    if (!sync) {
      return;
    }
    const durationMs = now - run.startedAt;
    const isSuccess = status === "success";
    const consecutive = isSuccess ? 0 : sync.consecutiveErrorCount + 1;
    const nextEligibleAt = isSuccess
      ? computeNextEligibleAt(now, sync.syncIntervalMs, ENGINE_SYNC_CONFIG.jitterMs)
      : computeNextEligibleAtAfterError(now, sync.syncIntervalMs, consecutive);
    await ctx.db.patch(sync._id, {
      status,
      lastSyncedAt: now,
      lastDurationMs: durationMs,
      consecutiveErrorCount: consecutive,
      lastError: error ?? "",
      nextEligibleAt,
    });
  },
});
