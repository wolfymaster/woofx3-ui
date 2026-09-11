import { parseDataShape, parseFieldList } from "@woofx3/api/ui-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  pruneActionDefinitions,
  pruneTriggerDefinitions,
  pruneWidgetDefinitions,
  uniqueIds,
} from "./lib/definitionCatalog";

// Provenance from the engine: createdByRef == the module's composite moduleKey
// (or "builtin" for SYSTEM resources). Drives cascade-on-delete; replaces moduleId.
type Provenance = { createdByType?: string; createdByRef?: string };

async function enableTriggerForInstance(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  triggerId: string,
  provenance: Provenance
) {
  const existing = await ctx.db
    .query("instanceTriggers")
    .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", triggerId))
    .first();
  if (!existing) {
    await ctx.db.insert("instanceTriggers", {
      instanceId,
      triggerId,
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
    });
    return;
  }
  // Backfill provenance when a later webhook supplies it for a row written without
  // it (race: MODULE_TRIGGER_REGISTERED can land before MODULE_INSTALLED).
  if (provenance.createdByRef && existing.createdByRef !== provenance.createdByRef) {
    await ctx.db.patch(existing._id, {
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
    });
  }
}

async function enableActionForInstance(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  actionId: string,
  provenance: Provenance
) {
  const existing = await ctx.db
    .query("instanceActions")
    .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", actionId))
    .first();
  if (!existing) {
    await ctx.db.insert("instanceActions", {
      instanceId,
      actionId,
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
    });
    return;
  }
  if (provenance.createdByRef && existing.createdByRef !== provenance.createdByRef) {
    await ctx.db.patch(existing._id, {
      createdByType: provenance.createdByType,
      createdByRef: provenance.createdByRef,
    });
  }
}

async function disableTriggerForInstance(ctx: MutationCtx, instanceId: Id<"instances">, triggerId: string) {
  const existing = await ctx.db
    .query("instanceTriggers")
    .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", triggerId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

async function disableActionForInstance(ctx: MutationCtx, instanceId: Id<"instances">, actionId: string) {
  const existing = await ctx.db
    .query("instanceActions")
    .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", actionId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
}

/*
 * Payload shape for trigger/action definitions inside module.installed and
 * module.trigger.registered / module.action.registered webhooks. This mirrors
 * @woofx3/api/webhooks TriggerDefinition / ActionDefinition — the engine
 * forwards these as-is.
 *
 * Only `id` is required. Every other field is allowed to be missing so we
 * process partial payloads gracefully; defaults are applied in `translate*`
 * below before anything is written to Convex.
 */
const triggerValidator = v.object({
  id: v.string(),
  category: v.optional(v.string()),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  event: v.optional(v.string()),
  configSchema: v.optional(v.string()),
  emits: v.optional(v.string()),
  allowVariants: v.optional(v.boolean()),
  createdByType: v.optional(v.string()),
  createdByRef: v.optional(v.string()),
  projectionKey: v.optional(v.string()),
  taxonomy: v.optional(v.array(v.string())),
});

const actionValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  call: v.optional(v.string()),
  type: v.optional(v.string()),
  paramsSchema: v.optional(v.string()),
  returns: v.optional(v.string()),
  createdByType: v.optional(v.string()),
  createdByRef: v.optional(v.string()),
  projectionKey: v.optional(v.string()),
  taxonomy: v.optional(v.array(v.string())),
});

/*
 * Presentation fields the UI needs to render a trigger / action. The engine
 * doesn't model these — it forwards an opaque configSchema / paramsSchema
 * string. Whatever the module author put in that string is parsed best-
 * effort here; anything the parser can't extract falls back to the defaults
 * below so the workflow builder always has something to render.
 */
const DEFAULT_UI_COLOR = "#888888";
const DEFAULT_TRIGGER_ICON = "Zap";
const DEFAULT_ACTION_ICON = "ArrowRight";
const DEFAULT_ACTION_CATEGORY = "General";

type TriggerUiFields = {
  color: string;
  icon: string;
  configFields?: unknown[];
  emits?: unknown[];
};

type ActionUiFields = {
  color: string;
  icon: string;
  configFields?: unknown[];
  returns?: unknown[];
};

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

/**
 * Pick presentation fields from a trigger's configSchema / emits.
 *
 * `color` and `icon` used to be read out of the schema container; nothing has
 * ever set them, and the container they lived in no longer exists, so every
 * trigger takes the defaults.
 */
function triggerUi(configSchema: string | undefined, emits: string | undefined): TriggerUiFields {
  const fields = parseFieldList(configSchema);
  const shape = parseDataShape(emits);
  return {
    color: DEFAULT_UI_COLOR,
    icon: DEFAULT_TRIGGER_ICON,
    configFields: fields.length > 0 ? fields : undefined,
    emits: shape ? shape.fields : undefined,
  };
}

function actionUi(paramsSchema: string | undefined, returns: string | undefined): ActionUiFields {
  const fields = parseFieldList(paramsSchema);
  // `returns` is a DataShape, not a field list: it names values that exist at
  // runtime rather than controls to render, so it parses differently.
  const shape = parseDataShape(returns);
  return {
    color: DEFAULT_UI_COLOR,
    icon: DEFAULT_ACTION_ICON,
    configFields: fields.length > 0 ? fields : undefined,
    returns: shape ? shape.fields : undefined,
  };
}

type EngineTrigger = {
  id: string;
  category?: string;
  name?: string;
  description?: string;
  event?: string;
  configSchema?: string;
  emits?: string;
  allowVariants?: boolean;
  projectionKey?: string;
  taxonomy?: string[];
};

type EngineAction = {
  id: string;
  name?: string;
  description?: string;
  call?: string;
  type?: string;
  paramsSchema?: string;
  returns?: string;
  projectionKey?: string;
  taxonomy?: string[];
};

function translateTrigger(t: EngineTrigger, moduleId: Id<"moduleRepository"> | undefined) {
  const ui = triggerUi(t.configSchema, t.emits);
  return {
    slug: t.id,
    name: t.name ?? t.id,
    description: t.description ?? "",
    category: t.category ?? "General",
    event: t.event || undefined,
    color: ui.color,
    icon: ui.icon,
    configFields: ui.configFields,
    emits: ui.emits,
    allowVariants: t.allowVariants,
    projectionKey: t.projectionKey,
    taxonomy: t.taxonomy,
    moduleId,
  };
}

function translateAction(a: EngineAction, moduleId: Id<"moduleRepository"> | undefined) {
  const ui = actionUi(a.paramsSchema, a.returns);
  const handlerType = a.type?.trim() || (a.call?.trim() ? "function" : undefined);
  return {
    slug: a.id,
    name: a.name ?? a.id,
    description: a.description ?? "",
    category: DEFAULT_ACTION_CATEGORY,
    color: ui.color,
    icon: ui.icon,
    configFields: ui.configFields,
    returns: ui.returns,
    projectionKey: a.projectionKey,
    taxonomy: a.taxonomy,
    handlerType,
    functionCall: a.call?.trim() || undefined,
    moduleId,
  };
}

/**
 * The row an incoming install replaces: this instance's record for the same
 * module (matched on the version-free leading segment of the moduleKey) at a
 * different version.
 *
 * The engine upgrades in place — barkloader tears down the previous version's
 * triggers, actions, widgets, workflows and commands before registering the
 * new ones, under a unique constraint on module name — so a second Convex row
 * would misrepresent one module as two: the superseded version would sit in
 * the Installed list forever, and every row pointing at the old record
 * (trigger/action definitions, functions, widgets, assets, resource
 * instances) would be stranded on it. Patching keeps the _id stable so those
 * links survive the upgrade, and refreshes moduleKey so a later uninstall —
 * which cascades on `createdByRef == record.moduleKey` — still matches.
 */
async function findSupersededModule(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  correlationKey: string
): Promise<Doc<"moduleRepository"> | null> {
  const bareKey = correlationKey.split(":")[0];
  if (!bareKey) {
    return null;
  }
  // Bounded by the modules installed on one instance, and there is no index on
  // the leading segment of moduleKey — the same scan resolveModuleForDetail does.
  const installed = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();
  return installed.find((m) => m.moduleKey?.split(":")[0] === bareKey) ?? null;
}

/**
 * Process a module.installed webhook callback from the engine.
 * Flips the "pending" moduleRepository record created by uploadAndDeliver to
 * "installed", leaving its manifest untouched. Marketplace installs don't
 * create a pending record up front (no client-parsed manifest exists for
 * them), so that path falls back to inserting a manifest-less row here —
 * http.ts schedules moduleManifestSync.syncManifest right after this
 * returns, which fetches the engine's authoritative manifest and backfills
 * it regardless of which path was taken.
 *
 * An upgrade arrives here as a new versioned moduleKey for a module that is
 * already installed, and is applied to the existing row rather than inserted
 * beside it — see `findSupersededModule`.
 */
export const processModuleInstalled = internalMutation({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    moduleName: v.string(),
    moduleVersion: v.string(),
    triggers: v.array(triggerValidator),
    actions: v.array(actionValidator),
  },
  handler: async (ctx, { instanceId, correlationKey, moduleName, moduleVersion, triggers, actions }) => {
    // Check if this instance already has the row (idempotency)
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_name_version", (q) =>
        q.eq("instanceId", instanceId).eq("name", moduleName).eq("version", moduleVersion)
      )
      .first();

    const superseded = record ? null : await findSupersededModule(ctx, instanceId, correlationKey);

    let moduleId: Id<"moduleRepository">;
    if (record) {
      await ctx.db.patch(record._id, {
        status: "installed" as const,
        statusMessage: undefined,
        moduleKey: record.moduleKey ?? correlationKey,
      });
      moduleId = record._id;
    } else if (superseded) {
      await ctx.db.patch(superseded._id, {
        status: "installed" as const,
        statusMessage: undefined,
        moduleKey: correlationKey,
        name: moduleName,
        version: moduleVersion,
      });
      moduleId = superseded._id;
    } else {
      moduleId = await ctx.db.insert("moduleRepository", {
        instanceId,
        moduleKey: correlationKey,
        name: moduleName,
        description: "",
        version: moduleVersion,
        tags: [],
        manifest: {},
        archiveKey: "",
        status: "installed" as const,
      });
    }

    // Emit success event for the UI
    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.install",
      status: "success",
      message: `Module ${moduleName}@${moduleVersion} installed successfully.`,
    });

    for (const trigger of triggers) {
      const row = translateTrigger(trigger, moduleId);
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("triggerDefinitions", row);
      }
      await enableTriggerForInstance(ctx, instanceId, row.slug, {
        createdByType: trigger.createdByType,
        createdByRef: trigger.createdByRef,
      });
    }

    for (const action of actions) {
      const row = translateAction(action, moduleId);
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("actionDefinitions", row);
      }
      await enableActionForInstance(ctx, instanceId, row.slug, {
        createdByType: action.createdByType,
        createdByRef: action.createdByRef,
      });
    }

    return moduleId;
  },
});

/**
 * Process trigger/action deregistration events from the engine. Fires on
 * MODULE_TRIGGER_DEREGISTERED and MODULE_ACTION_DEREGISTERED — part of a module
 * delete, and also of an upgrade, which tears the previous version's
 * registrations down before installing the new ones. Clears this instance's
 * enablement so its workflow builder no longer surfaces stale options, then
 * drops the shared catalog row only if no other instance still enables it.
 *
 * Idempotent: deletes only when the row exists; missing rows are skipped.
 */
export const processDeregisteredDefinitions = internalMutation({
  args: {
    instanceId: v.id("instances"),
    triggers: v.array(triggerValidator),
    actions: v.array(actionValidator),
  },
  handler: async (ctx, { instanceId, triggers, actions }) => {
    // Disable first, prune second: the shared-catalog check asks whether any
    // instance still enables the definition, and this one no longer should
    // count itself.
    for (const trigger of triggers) {
      await disableTriggerForInstance(ctx, instanceId, trigger.id);
    }
    await pruneTriggerDefinitions(ctx, uniqueIds(triggers.map((t) => t.id)));

    for (const action of actions) {
      await disableActionForInstance(ctx, instanceId, action.id);
    }
    await pruneActionDefinitions(ctx, uniqueIds(actions.map((a) => a.id)));
  },
});

/**
 * Process trigger/action registration events from the engine.
 * These are standalone events — they don't require a moduleKey or correlationKey.
 * They upsert definitions and optionally link to an existing module record.
 */
export const processRegisteredDefinitions = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleName: v.string(),
    moduleVersion: v.string(),
    triggers: v.array(triggerValidator),
    actions: v.array(actionValidator),
  },
  handler: async (ctx, { instanceId, moduleName, moduleVersion, triggers, actions }) => {
    // Try to find this instance's module record to link definitions to it
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_name_version", (q) =>
        q.eq("instanceId", instanceId).eq("name", moduleName).eq("version", moduleVersion)
      )
      .first();
    const moduleId = record?._id;

    for (const trigger of triggers) {
      const row = translateTrigger(trigger, moduleId);
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("triggerDefinitions", row);
      }
      await enableTriggerForInstance(ctx, instanceId, row.slug, {
        createdByType: trigger.createdByType,
        createdByRef: trigger.createdByRef,
      });
    }

    for (const action of actions) {
      const row = translateAction(action, moduleId);
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("actionDefinitions", row);
      }
      await enableActionForInstance(ctx, instanceId, row.slug, {
        createdByType: action.createdByType,
        createdByRef: action.createdByRef,
      });
    }
  },
});

/**
 * Process a module.install_failed webhook callback from the engine.
 * Flips the "pending" moduleRepository record created by uploadAndDeliver to
 * "failed" (if one exists — marketplace installs don't create one up front),
 * then emits a transient error event.
 */
export const processModuleInstallFailed = internalMutation({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    moduleName: v.string(),
    moduleVersion: v.string(),
    statusMessage: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, correlationKey, moduleName, moduleVersion, statusMessage }) => {
    const failMessage = statusMessage ?? "Module installation failed on the engine.";

    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", correlationKey))
      .first();
    if (record) {
      await ctx.db.patch(record._id, { status: "failed" as const, statusMessage: failMessage });
    }

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.install",
      status: "error",
      message: failMessage,
      data: { moduleName, moduleVersion },
    });
  },
});

/**
 * Process a module.deleted webhook callback from the engine.
 * Cascade-deletes the moduleRepository record + storage blob + trigger/action
 * definitions, then emits a success transient event for the UI. Idempotent:
 * if no record exists (already deleted or webhook re-delivery), still emits
 * success so the UI advances.
 *
 * Lookup order: by moduleKey (exact match on correlationKey) first, then by
 * name+version if the engine didn't echo a version or the key doesn't match.
 * Falls back to deleting any record with the same name when version is absent.
 */
/**
 * Cascade-delete a confirmed-gone module: storage blob, per-instance join
 * rows (matched by createdByRef == the module's moduleKey), global UI
 * catalog defs, and module-owned functions/assets/resource instances.
 *
 * Shared by the module.deleted webhook path (which locates the record by
 * the engine-echoed moduleKey) and uninstall reconciliation (which already
 * holds the record because it was looked up by moduleId — see
 * `reconcileUninstalledModule` below, used when the webhook never arrives).
 */
async function cascadeDeleteModuleRecord(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  record: Doc<"moduleRepository">
) {
  if (record.archiveKey) {
    await ctx.storage.delete(record.archiveKey as Id<"_storage">);
  }

  // Authoritative cleanup: walk the per-instance join rows by provenance.
  // createdByRef == the module's composite moduleKey, so this catches every
  // enablement for this module regardless of catalog moduleId races.
  // Built-ins (createdByRef "builtin") are never matched, so they survive.
  const createdByRef = record.moduleKey ?? record._id;
  const enabledTriggerRows = await ctx.db
    .query("instanceTriggers")
    .withIndex("by_instance_ref", (q) => q.eq("instanceId", instanceId).eq("createdByRef", createdByRef))
    .collect();
  const enabledActionRows = await ctx.db
    .query("instanceActions")
    .withIndex("by_instance_ref", (q) => q.eq("instanceId", instanceId).eq("createdByRef", createdByRef))
    .collect();
  const enabledWidgetRows = await ctx.db
    .query("instanceWidgets")
    .withIndex("by_instance_ref", (q) => q.eq("instanceId", instanceId).eq("createdByRef", createdByRef))
    .collect();
  for (const row of enabledTriggerRows) {
    await ctx.db.delete(row._id);
  }
  for (const row of enabledActionRows) {
    await ctx.db.delete(row._id);
  }
  for (const row of enabledWidgetRows) {
    await ctx.db.delete(row._id);
  }

  // Clean global UI catalog rows. These are a single shared catalog keyed by
  // stable slug: every instance that installs the module points at the same
  // row, and its moduleId records only whichever instance registered it last.
  // So "the module is gone here" must not mean "the definition is gone" — a
  // def survives while any instance still enables it, and only the last user
  // takes it down.
  const moduleTriggerDefs = await ctx.db
    .query("triggerDefinitions")
    .withIndex("by_module", (q) => q.eq("moduleId", record._id))
    .collect();
  const moduleActionDefs = await ctx.db
    .query("actionDefinitions")
    .withIndex("by_module", (q) => q.eq("moduleId", record._id))
    .collect();
  const moduleWidgetDefs = await ctx.db
    .query("moduleWidgets")
    .withIndex("by_module", (q) => q.eq("moduleId", record._id))
    .collect();

  // Candidates come from both directions: the slugs this cascade just
  // un-enabled — authoritative, since join rows are per-instance — and any def
  // still pointing at the record about to be deleted, so none is left dangling
  // at a dead id.
  await pruneTriggerDefinitions(
    ctx,
    uniqueIds(enabledTriggerRows.map((r) => r.triggerId).concat(moduleTriggerDefs.map((d) => d.slug))),
    record._id
  );
  await pruneActionDefinitions(
    ctx,
    uniqueIds(enabledActionRows.map((r) => r.actionId).concat(moduleActionDefs.map((d) => d.slug))),
    record._id
  );
  await pruneWidgetDefinitions(
    ctx,
    uniqueIds(enabledWidgetRows.map((r) => r.widgetId).concat(moduleWidgetDefs.map((d) => d.widgetId))),
    record._id
  );

  await ctx.runMutation(internal.moduleFunctions.cascadeOnModuleDelete, {
    instanceId,
    moduleId: record._id,
  });
  await ctx.runMutation(internal.moduleAssets.cascadeOnModuleDelete, {
    moduleId: record._id,
  });
  await ctx.runMutation(internal.moduleResourceInstances.cascadeOnModuleDelete, {
    moduleId: record._id,
  });
  await ctx.db.delete(record._id);
}

export const processModuleDeleted = internalMutation({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    moduleName: v.string(),
    moduleVersion: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, correlationKey, moduleName, moduleVersion }) => {
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", correlationKey))
      .first();

    if (record) {
      await cascadeDeleteModuleRecord(ctx, instanceId, record);
    }

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.uninstall",
      status: "success",
      message: `Module ${moduleName}${moduleVersion ? `@${moduleVersion}` : ""} removed.`,
      data: { moduleName, moduleVersion },
    });
  },
});

/**
 * Reconcile a moduleRepository record after confirming directly with the
 * engine (via listEngineModules) that the module is no longer installed
 * there. This covers the case where the module.deleted webhook never
 * arrives at Convex — dropped delivery, a slow background delete that
 * outlasts the engine's single retry, or a Convex-side exception on the
 * first attempt — leaving the UI waiting on a transient event that will
 * never come even though the engine has already finished the uninstall.
 *
 * Looked up by moduleId (not moduleKey) because the caller already holds
 * the record directly, so this is immune to the moduleKey-mismatch cases
 * that can make the webhook's `by_module_key` lookup miss.
 */
export const reconcileUninstalledModule = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    correlationKey: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, correlationKey }) => {
    const record = await ctx.db.get(moduleId);
    if (!record) {
      return;
    }

    const moduleName = record.name;
    const moduleVersion = record.version;
    await cascadeDeleteModuleRecord(ctx, instanceId, record);

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.uninstall",
      status: "success",
      message: `Module ${moduleName}@${moduleVersion} removed.`,
      data: { moduleName, moduleVersion },
    });
  },
});

/**
 * Process a module.delete_failed webhook callback from the engine.
 * The module is still installed on the engine — the moduleRepository record
 * is left untouched. Emits an error transient event carrying the conflict
 * list so the UI can show the user why the delete was refused.
 */
/**
 * Best-effort: the engine sent a delete webhook without a moduleKey, so we
 * can't correlate it directly. Look up this instance's moduleRepository record
 * by name and emit an error transient event under its stored moduleKey so the
 * UI subscription unsticks. If no record is found (or it has no moduleKey),
 * there's no pending UI subscription to notify — log and drop.
 *
 * Scoped to the instance: another tenant's row for the same module carries a
 * different moduleKey, so emitting under it would leave the dialog that is
 * actually waiting stuck until its timeout.
 */
export const emitDeleteErrorForMissingKey = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleName: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { instanceId, moduleName, reason }) => {
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_instance_name_version", (q) => q.eq("instanceId", instanceId).eq("name", moduleName))
      .first();

    const correlationKey = record?.moduleKey;
    if (!correlationKey) {
      return;
    }

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.uninstall",
      status: "error",
      message: reason,
      data: { moduleName, conflicts: [] },
    });
  },
});

export const processModuleDeleteFailed = internalMutation({
  args: {
    instanceId: v.id("instances"),
    correlationKey: v.string(),
    moduleName: v.string(),
    moduleVersion: v.optional(v.string()),
    error: v.optional(v.string()),
    conflicts: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { instanceId, correlationKey, moduleName, moduleVersion, error, conflicts }) => {
    const message = error ?? "Module delete was refused by the engine.";

    await ctx.runMutation(internal.transientEvents.emit, {
      instanceId,
      correlationKey,
      type: "module.uninstall",
      status: "error",
      message,
      data: { moduleName, moduleVersion, conflicts: conflicts ?? [] },
    });
  },
});
