import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { computeNextEligibleAt, computeNextEligibleAtAfterError, ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";
import { parseConfigSchemaString } from "./lib/parseConfigSchema";
import { canAccessAccount } from "./lib/teamAccess";

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
 * truth: every row is upserted by `engineCommandId`; rows whose
 * `engineCommandId` no longer appears in the snapshot are deleted.
 *
 * The engine's `CommandSnapshot` (see `@woofx3/api`) carries the
 * type-discriminated payload in a single `typeValue` string, plus the
 * `visibility`/`groupIds`/`usernames` permission fields — see
 * docs/services/commands-ui.md in the woofx3 engine repo.
 */
export const reconcileCommands = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    snapshots: v.array(
      v.object({
        engineCommandId: v.string(),
        command: v.string(),
        type: v.union(v.literal("text"), v.literal("function")),
        typeValue: v.string(),
        cooldown: v.number(),
        priority: v.number(),
        enabled: v.boolean(),
        visibility: v.union(v.literal("public"), v.literal("restricted")),
        groupIds: v.array(v.string()),
        usernames: v.array(v.string()),
        argumentPattern: v.string(),
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
      existingByEngineId.set(row.engineCommandId, row);
    }

    const snapshotIds = new Set(snapshots.map((s) => s.engineCommandId));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByEngineId.get(snap.engineCommandId);
      const fields = {
        applicationId,
        command: snap.command,
        type: snap.type,
        typeValue: snap.typeValue,
        cooldown: snap.cooldown,
        priority: snap.priority,
        enabled: snap.enabled,
        visibility: snap.visibility,
        groupIds: snap.groupIds,
        usernames: snap.usernames,
        argumentPattern: snap.argumentPattern,
        updatedAt: now,
      };
      if (found) {
        await ctx.db.patch(found._id, fields);
      } else {
        await ctx.db.insert("chatCommands", {
          instanceId,
          engineCommandId: snap.engineCommandId,
          ...fields,
          createdAt: now,
        });
      }
      processed++;
    }

    // Delete rows whose engineCommandId disappeared from the engine.
    for (const row of existing) {
      if (!snapshotIds.has(row.engineCommandId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the local `chatCommandGroups` mirror (plus the full
 * `chatCommandGroupMembers` roster per group) against a full snapshot
 * returned by the engine's `listGroups()` + `listGroupMembers(groupId)`.
 * The engine is the source of truth: groups are upserted by
 * `engineGroupId`; groups that disappeared are deleted along with their
 * membership rows. Each group's membership rows are full-replaced (the
 * engine's `listGroupMembers` returns the complete live roster, not a diff).
 */
export const reconcileGroups = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    snapshots: v.array(
      v.object({
        engineGroupId: v.string(),
        name: v.string(),
        description: v.string(),
        engineCreatedAt: v.string(),
        members: v.array(v.string()),
      })
    ),
  },
  handler: async (ctx, { instanceId, applicationId, snapshots }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("chatCommandGroups")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();

    const existingByEngineId = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      existingByEngineId.set(row.engineGroupId, row);
    }

    const snapshotIds = new Set(snapshots.map((s) => s.engineGroupId));
    let processed = 0;

    for (const snap of snapshots) {
      const found = existingByEngineId.get(snap.engineGroupId);
      const fields = {
        applicationId,
        name: snap.name,
        description: snap.description,
        engineCreatedAt: snap.engineCreatedAt,
        updatedAt: now,
      };
      if (found) {
        await ctx.db.patch(found._id, fields);
      } else {
        await ctx.db.insert("chatCommandGroups", {
          instanceId,
          engineGroupId: snap.engineGroupId,
          ...fields,
          createdAt: now,
        });
      }

      // Full-replace membership for this group.
      const existingMembers = await ctx.db
        .query("chatCommandGroupMembers")
        .withIndex("by_group", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", snap.engineGroupId))
        .collect();
      const existingUsernames = new Set(existingMembers.map((m) => m.username));
      const liveUsernames = new Set(snap.members);

      for (const username of snap.members) {
        if (!existingUsernames.has(username)) {
          await ctx.db.insert("chatCommandGroupMembers", {
            instanceId,
            engineGroupId: snap.engineGroupId,
            username,
          });
        }
      }
      for (const member of existingMembers) {
        if (!liveUsernames.has(member.username)) {
          await ctx.db.delete(member._id);
        }
      }

      processed++;
    }

    // Delete groups (and their membership rows) whose engineGroupId disappeared.
    for (const row of existing) {
      if (!snapshotIds.has(row.engineGroupId)) {
        const orphanMembers = await ctx.db
          .query("chatCommandGroupMembers")
          .withIndex("by_group", (q) => q.eq("instanceId", instanceId).eq("engineGroupId", row.engineGroupId))
          .collect();
        for (const m of orphanMembers) {
          await ctx.db.delete(m._id);
        }
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
        .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", u.engineWorkflowId))
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
        .withIndex("by_engine_scene_id", (q) => q.eq("instanceId", instanceId).eq("engineSceneId", u.engineSceneId))
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

const DEFAULT_UI_COLOR = "#888888";
const DEFAULT_TRIGGER_ICON = "Zap";

function parseJsonSafe(raw: string | undefined): unknown {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function triggerUiFields(configSchema: string | undefined): {
  color: string;
  icon: string;
  configFields?: unknown[];
} {
  const { fields, color, icon } = parseConfigSchemaString(configSchema);
  return {
    color: color ?? DEFAULT_UI_COLOR,
    icon: icon ?? DEFAULT_TRIGGER_ICON,
    configFields: fields.length > 0 ? fields : undefined,
  };
}

/**
 * Reconcile `triggerDefinitions` (global UI catalog) and `instanceTriggers`
 * (per-instance enablement) against a full snapshot from `getTriggers()`.
 *
 * `triggerDefinitions` rows are only upserted — never deleted — because the
 * catalog is global and a trigger absent from one instance may still be
 * registered elsewhere.
 *
 * `instanceTriggers` rows for this instance whose `triggerId` no longer
 * appears in the engine snapshot are deleted.
 */
export const reconcileTriggers = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        id: v.string(),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        category: v.optional(v.string()),
        event: v.optional(v.string()),
        configSchema: v.optional(v.string()),
        allowVariants: v.optional(v.boolean()),
        projectionKey: v.optional(v.string()),
        createdByType: v.optional(v.string()),
        createdByRef: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const snapshotIds = new Set(snapshots.map((s) => s.id));
    let processed = 0;

    for (const snap of snapshots) {
      let moduleId: Id<"moduleRepository"> | undefined;
      if (snap.createdByType === "MODULE" && snap.createdByRef) {
        const mod = await ctx.db
          .query("moduleRepository")
          .withIndex("by_module_key", (q) => q.eq("moduleKey", snap.createdByRef!))
          .first();
        moduleId = mod?._id;
      }

      const ui = triggerUiFields(snap.configSchema);
      const defRow = {
        slug: snap.id,
        name: snap.name ?? snap.id,
        description: snap.description ?? "",
        category: snap.category ?? "General",
        event: snap.event || undefined,
        color: ui.color,
        icon: ui.icon,
        configFields: ui.configFields,
        allowVariants: snap.allowVariants,
        projectionKey: snap.projectionKey,
        moduleId,
      };
      const existingDef = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", defRow.slug))
        .first();
      if (existingDef) {
        await ctx.db.patch(existingDef._id, defRow);
      } else {
        await ctx.db.insert("triggerDefinitions", defRow);
      }

      const existingInst = await ctx.db
        .query("instanceTriggers")
        .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", snap.id))
        .first();
      if (existingInst) {
        if (snap.createdByRef && existingInst.createdByRef !== snap.createdByRef) {
          await ctx.db.patch(existingInst._id, {
            createdByType: snap.createdByType,
            createdByRef: snap.createdByRef,
            projectionKey: snap.projectionKey,
          });
        }
      } else {
        await ctx.db.insert("instanceTriggers", {
          instanceId,
          triggerId: snap.id,
          createdByType: snap.createdByType,
          createdByRef: snap.createdByRef,
          projectionKey: snap.projectionKey,
        });
      }

      processed++;
    }

    // Delete instanceTriggers rows for this instance no longer in the engine snapshot.
    const liveInstRows = await ctx.db
      .query("instanceTriggers")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of liveInstRows) {
      if (!snapshotIds.has(row.triggerId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

const DEFAULT_ACTION_ICON = "ArrowRight";
const DEFAULT_ACTION_CATEGORY = "General";

function actionUiFields(paramsSchema: string | undefined): {
  color: string;
  icon: string;
  configFields?: unknown[];
} {
  const { fields, color, icon } = parseConfigSchemaString(paramsSchema);
  return {
    color: color ?? DEFAULT_UI_COLOR,
    icon: icon ?? DEFAULT_ACTION_ICON,
    configFields: fields.length > 0 ? fields : undefined,
  };
}

/**
 * Reconcile `actionDefinitions` (global UI catalog) and `instanceActions`
 * (per-instance enablement) against a full snapshot from `getActions()`.
 *
 * `actionDefinitions` rows are only upserted — never deleted — because the
 * catalog is global and an action absent from one instance may still be
 * registered on another.
 *
 * `instanceActions` rows for this instance whose `actionId` no longer
 * appears in the engine snapshot are deleted.
 */
export const reconcileActions = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        id: v.string(),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        paramsSchema: v.optional(v.string()),
        projectionKey: v.optional(v.string()),
        handlerType: v.optional(v.string()),
        functionCall: v.optional(v.string()),
        createdByType: v.optional(v.string()),
        createdByRef: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const snapshotIds = new Set(snapshots.map((s) => s.id));
    let processed = 0;

    for (const snap of snapshots) {
      let moduleId: Id<"moduleRepository"> | undefined;
      if (snap.createdByType === "MODULE" && snap.createdByRef) {
        const mod = await ctx.db
          .query("moduleRepository")
          .withIndex("by_module_key", (q) => q.eq("moduleKey", snap.createdByRef!))
          .first();
        moduleId = mod?._id;
      }

      const ui = actionUiFields(snap.paramsSchema);
      const handlerType = snap.handlerType?.trim() || (snap.functionCall?.trim() ? "function" : undefined);
      const defRow = {
        slug: snap.id,
        name: snap.name ?? snap.id,
        description: snap.description ?? "",
        category: DEFAULT_ACTION_CATEGORY,
        color: ui.color,
        icon: ui.icon,
        configFields: ui.configFields,
        projectionKey: snap.projectionKey,
        handlerType,
        functionCall: snap.functionCall?.trim() || undefined,
        moduleId,
      };
      const existingDef = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", defRow.slug))
        .first();
      if (existingDef) {
        await ctx.db.patch(existingDef._id, defRow);
      } else {
        await ctx.db.insert("actionDefinitions", defRow);
      }

      const existingInst = await ctx.db
        .query("instanceActions")
        .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", snap.id))
        .first();
      if (existingInst) {
        if (snap.createdByRef && existingInst.createdByRef !== snap.createdByRef) {
          await ctx.db.patch(existingInst._id, {
            createdByType: snap.createdByType,
            createdByRef: snap.createdByRef,
            projectionKey: snap.projectionKey,
          });
        }
      } else {
        await ctx.db.insert("instanceActions", {
          instanceId,
          actionId: snap.id,
          createdByType: snap.createdByType,
          createdByRef: snap.createdByRef,
          projectionKey: snap.projectionKey,
        });
      }

      processed++;
    }

    const liveInstRows = await ctx.db
      .query("instanceActions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of liveInstRows) {
      if (!snapshotIds.has(row.actionId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the widget definition catalog (`moduleWidgets`) AND per-instance
 * placement (`instanceWidgets`) against a full snapshot from
 * `getAvailableWidgets()`.
 *
 * Definitions are upserted by `widgetId`; `moduleId` is resolved only for
 * module-sourced widgets (built-ins have none and are NOT skipped). Per-instance
 * `instanceWidgets` rows are reconciled for this instance: rows whose `widgetId`
 * disappears from the snapshot are deleted (the engine is source of truth for the
 * instance's placeable set). Definition rows are never deleted here.
 */
export const reconcileWidgets = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        directory: v.string(),
        description: v.optional(v.string()),
        alertTypes: v.array(v.string()),
        settings: v.array(
          v.object({
            key: v.string(),
            fieldType: v.string(),
            label: v.string(),
            defaultValue: v.any(),
            options: v.optional(v.array(v.object({ label: v.string(), value: v.string() }))),
          })
        ),
        createdByType: v.string(),
        createdByRef: v.string(),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const snapshotIds = new Set(snapshots.map((s) => s.id));
    let processed = 0;

    for (const snap of snapshots) {
      // Resolve moduleId only for module-sourced widgets; built-ins have none.
      let moduleId: Id<"moduleRepository"> | undefined;
      if (snap.createdByType === "MODULE" && snap.createdByRef) {
        const mod = await ctx.db
          .query("moduleRepository")
          .withIndex("by_module_key", (q) => q.eq("moduleKey", snap.createdByRef))
          .first();
        moduleId = mod?._id;
      }

      const defRow = {
        moduleId,
        widgetId: snap.id,
        name: snap.name,
        directory: snap.directory,
        description: snap.description,
        createdByType: snap.createdByType,
        createdByRef: snap.createdByRef,
        alertTypes: snap.alertTypes,
        settings: snap.settings,
      };
      const existingDef = await ctx.db
        .query("moduleWidgets")
        .withIndex("by_widget_id", (q) => q.eq("widgetId", snap.id))
        .first();
      if (existingDef) {
        await ctx.db.patch(existingDef._id, defRow);
      } else {
        await ctx.db.insert("moduleWidgets", { ...defRow, createdAt: Date.now() });
      }

      const existingInst = await ctx.db
        .query("instanceWidgets")
        .withIndex("by_instance_widget", (q) => q.eq("instanceId", instanceId).eq("widgetId", snap.id))
        .first();
      if (!existingInst) {
        await ctx.db.insert("instanceWidgets", {
          instanceId,
          widgetId: snap.id,
          createdByType: snap.createdByType,
          createdByRef: snap.createdByRef,
        });
      } else if (existingInst.createdByRef !== snap.createdByRef) {
        await ctx.db.patch(existingInst._id, {
          createdByType: snap.createdByType,
          createdByRef: snap.createdByRef,
        });
      }

      processed++;
    }

    // Drop instanceWidgets rows for this instance no longer present in the snapshot.
    const liveInstRows = await ctx.db
      .query("instanceWidgets")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of liveInstRows) {
      if (!snapshotIds.has(row.widgetId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
  },
});

/**
 * Reconcile the `moduleFunctions` catalog (global) AND `instanceFunctions`
 * (per-instance enablement) against a full snapshot from the engine's
 * `listAvailableFunctions()`. Self-healing counterpart to the
 * MODULE_FUNCTION_REGISTERED/_DEREGISTERED webhooks (convex/moduleFunctions.ts):
 * those give near-instant updates on (de)registration, this step recovers
 * modules whose registration webhook was missed or predates that path.
 *
 * `listAvailableFunctions()` carries `moduleName` but no stable module key/id
 * that maps onto `moduleRepository`, so `moduleId` is resolved by matching
 * `moduleName` against this instance's installed modules — best-effort, and
 * left untouched (falls back to whatever the MODULE_FUNCTION_REGISTERED
 * webhook already resolved) when an existing row already has one.
 *
 * Definition rows are only upserted — never deleted — matching the other
 * catalogs (triggerDefinitions/actionDefinitions/moduleWidgets); only this
 * instance's `instanceFunctions` enablement rows are pruned.
 */
export const reconcileFunctions = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshots: v.array(
      v.object({
        engineFunctionId: v.string(),
        moduleName: v.string(),
        manifestId: v.string(),
        name: v.string(),
        runtime: v.string(),
      })
    ),
  },
  handler: async (ctx, { instanceId, snapshots }) => {
    const modulesForInstance = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    const moduleIdByName = new Map(modulesForInstance.map((m) => [m.name, m._id]));
    const moduleKeyByName = new Map(modulesForInstance.map((m) => [m.name, m.moduleKey]));

    const snapshotIds = new Set(snapshots.map((s) => s.engineFunctionId));
    let processed = 0;

    for (const snap of snapshots) {
      const existing = await ctx.db
        .query("moduleFunctions")
        .withIndex("by_engine_id", (q) => q.eq("engineFunctionId", snap.engineFunctionId))
        .first();

      const moduleId = existing?.moduleId ?? moduleIdByName.get(snap.moduleName);

      // barkloader's ModuleRegistry resolves the invoke path as
      // `{engine moduleId}:function:{manifestId}`, where the engine moduleId
      // is the manifest's own declared `id` field — NOT this RPC's
      // AvailableFunction.moduleId (a DB row UUID, confirmed wrong against a
      // real engine) and NOT the display-name-based `snap.qualifiedName`
      // this RPC returns. moduleKey (module_manifest.rs::compute_module_key:
      // `{id}:{version}:{hash}`) is built from that same manifest id, so
      // derive it from moduleKey's first segment instead. See
      // docs/services/commands-ui.md in the woofx3 engine repo.
      const moduleKey = moduleKeyByName.get(snap.moduleName);
      const engineModuleId = moduleKey?.split(":")[0];
      const fields = {
        moduleId,
        moduleName: snap.moduleName,
        manifestId: snap.manifestId,
        functionName: snap.name,
        qualifiedName: engineModuleId ? `${engineModuleId}:function:${snap.manifestId}` : snap.manifestId,
        runtime: snap.runtime,
      };

      if (existing) {
        await ctx.db.patch(existing._id, fields);
      } else {
        await ctx.db.insert("moduleFunctions", {
          engineFunctionId: snap.engineFunctionId,
          fileName: "",
          entryPoint: "",
          ...fields,
        });
      }

      const existingInst = await ctx.db
        .query("instanceFunctions")
        .withIndex("by_instance_function", (q) =>
          q.eq("instanceId", instanceId).eq("functionId", snap.engineFunctionId)
        )
        .first();
      if (!existingInst) {
        // AvailableFunction (this RPC's response type) carries no
        // projectionKey — that's a webhook-only (FunctionDefinition) field.
        // Leave unset here rather than reuse the invocation-path qualifiedName.
        await ctx.db.insert("instanceFunctions", {
          instanceId,
          functionId: snap.engineFunctionId,
        });
      }

      processed++;
    }

    // Disable instanceFunctions rows for this instance no longer in the engine snapshot.
    const liveInstRows = await ctx.db
      .query("instanceFunctions")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
    for (const row of liveInstRows) {
      if (!snapshotIds.has(row.functionId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: processed };
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
        { name: "groups", status: "pending", itemsProcessed: 0 },
        { name: "functions", status: "pending", itemsProcessed: 0 },
        { name: "workflows", status: "pending", itemsProcessed: 0 },
        { name: "scenes", status: "pending", itemsProcessed: 0 },
        { name: "triggers", status: "pending", itemsProcessed: 0 },
        { name: "actions", status: "pending", itemsProcessed: 0 },
        { name: "widgets", status: "pending", itemsProcessed: 0 },
      ],
    });
  },
});

export const updateRunStep = internalMutation({
  args: {
    runId: v.id("syncRuns"),
    stepName: v.union(
      v.literal("commands"),
      v.literal("groups"),
      v.literal("functions"),
      v.literal("workflows"),
      v.literal("scenes"),
      v.literal("triggers"),
      v.literal("actions"),
      v.literal("widgets")
    ),
    patch: v.object({
      status: v.optional(v.union(v.literal("pending"), v.literal("running"), v.literal("success"), v.literal("error"))),
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

/**
 * Return up to `limit` instanceSync rows whose nextEligibleAt has passed,
 * joined with each owning instance's `lastEngineActivityAt`. The action
 * partitions these into "schedule" (active) vs "defer" (idle) buckets.
 */
export const findEligibleCandidates = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) => {
    const rows = await ctx.db
      .query("instanceSync")
      .withIndex("by_next_eligible", (q) => q.lte("nextEligibleAt", now))
      .take(limit * 4);
    const result: Array<{
      syncRowId: Id<"instanceSync">;
      instanceId: Id<"instances">;
      status: "idle" | "running" | "success" | "error";
      lastActive: number;
    }> = [];
    for (const r of rows) {
      const inst = await ctx.db.get(r.instanceId);
      if (!inst) {
        continue;
      }
      result.push({
        syncRowId: r._id,
        instanceId: r.instanceId,
        status: r.status,
        lastActive: inst.lastEngineActivityAt ?? 0,
      });
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  },
});

/** Push out nextEligibleAt for idle (no-activity) instances so we don't churn every tick. */
export const deferIdleInstance = internalMutation({
  args: { syncRowId: v.id("instanceSync"), now: v.number() },
  handler: async (ctx, { syncRowId, now }) => {
    await ctx.db.patch(syncRowId, {
      nextEligibleAt: now + ENGINE_SYNC_CONFIG.inactivityThresholdMs,
    });
  },
});

/**
 * Find instances that have no instanceSync row at all. We seed a row for them
 * during sweep so they enter the regular cadence.
 */
export const findInstancesMissingSyncRow = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("instanceSync").take(1000);
    const haveSync = new Set(rows.map((r) => r.instanceId));
    const instances = await ctx.db.query("instances").take(limit * 4);
    const missing: Array<Id<"instances">> = [];
    for (const inst of instances) {
      if (!haveSync.has(inst._id)) {
        missing.push(inst._id);
        if (missing.length >= limit) {
          break;
        }
      }
    }
    return missing;
  },
});

/** Returns the syncState + most recent + recent 5 runs for a given instance. */
export const getSyncStateForUser = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    const inst = await ctx.db.get(instanceId);
    if (!inst) {
      return null;
    }
    const allowed = await canAccessAccount(ctx, inst.accountId, userId);
    if (!allowed) {
      return null;
    }
    const syncState = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    const recentRuns = await ctx.db
      .query("syncRuns")
      .withIndex("by_instance_recent", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(5);
    const currentRun = recentRuns.find((r) => r.status === "running") ?? null;
    return { syncState, currentRun, recentRuns };
  },
});

/** Throws if user can't access; otherwise returns nothing. */
export const assertCanSyncInstance = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.id("users") },
  handler: async (ctx, { instanceId, userId }) => {
    const inst = await ctx.db.get(instanceId);
    if (!inst) {
      throw new Error("Instance not found");
    }
    const allowed = await canAccessAccount(ctx, inst.accountId, userId);
    if (!allowed) {
      throw new Error("Not authorized for this instance");
    }
    return true;
  },
});

/**
 * Delete syncRuns rows older than `runHistoryRetentionMs`. Runs on a daily
 * cron. Bounded by `.take(200)` per invocation so a single run can't blow
 * past Convex per-mutation limits — the next day's run picks up any
 * remainder.
 */
export const cleanupOldRuns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ENGINE_SYNC_CONFIG.runHistoryRetentionMs;
    const old = await ctx.db
      .query("syncRuns")
      .withIndex("by_started_at", (q) => q.lt("startedAt", cutoff))
      .take(200);
    for (const r of old) {
      await ctx.db.delete(r._id);
    }
    return old.length;
  },
});
