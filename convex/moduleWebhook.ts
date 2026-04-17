import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

const triggerValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  event: v.optional(v.string()),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
    supportsTiers: v.optional(v.boolean()),
    tierLabel: v.optional(v.string()),
  }),
});

const actionValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.string(),
  ui: v.object({
    color: v.string(),
    icon: v.string(),
    configFields: v.optional(v.array(v.any())),
  }),
});

/**
 * Process a module.installed webhook callback from the engine.
 * Creates the moduleRepository record and emits a success transient event.
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
    // Check if already exists by name+version (idempotency)
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_name_version", (q) => q.eq("name", moduleName).eq("version", moduleVersion))
      .first();

    let moduleId: Id<"moduleRepository">;
    if (record) {
      await ctx.db.patch(record._id, {
        status: "installed" as const,
        statusMessage: undefined,
        moduleKey: record.moduleKey ?? correlationKey,
      });
      moduleId = record._id;
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

    // Upsert trigger definitions
    for (const trigger of triggers) {
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", trigger.slug))
        .first();

      const data = {
        slug: trigger.slug,
        name: trigger.name,
        description: trigger.description,
        category: trigger.category,
        event: trigger.event,
        color: trigger.ui.color,
        icon: trigger.ui.icon,
        configFields: trigger.ui.configFields,
        supportsTiers: trigger.ui.supportsTiers,
        tierLabel: trigger.ui.tierLabel,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("triggerDefinitions", data);
      }
    }

    // Upsert action definitions
    for (const action of actions) {
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", action.slug))
        .first();

      const data = {
        slug: action.slug,
        name: action.name,
        description: action.description,
        category: action.category,
        color: action.ui.color,
        icon: action.ui.icon,
        configFields: action.ui.configFields,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("actionDefinitions", data);
      }
    }
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
  handler: async (ctx, { moduleName, moduleVersion, triggers, actions }) => {
    // Try to find the module record to link definitions to it
    const record = await ctx.db
      .query("moduleRepository")
      .withIndex("by_name_version", (q) => q.eq("name", moduleName).eq("version", moduleVersion))
      .first();
    const moduleId = record?._id;

    for (const trigger of triggers) {
      const existing = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", trigger.slug))
        .first();

      const data = {
        slug: trigger.slug,
        name: trigger.name,
        description: trigger.description,
        category: trigger.category,
        event: trigger.event,
        color: trigger.ui.color,
        icon: trigger.ui.icon,
        configFields: trigger.ui.configFields,
        supportsTiers: trigger.ui.supportsTiers,
        tierLabel: trigger.ui.tierLabel,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("triggerDefinitions", data);
      }
    }

    for (const action of actions) {
      const existing = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_slug", (q) => q.eq("slug", action.slug))
        .first();

      const data = {
        slug: action.slug,
        name: action.name,
        description: action.description,
        category: action.category,
        color: action.ui.color,
        icon: action.ui.icon,
        configFields: action.ui.configFields,
        moduleId,
      };

      if (existing) {
        await ctx.db.patch(existing._id, data);
      } else {
        await ctx.db.insert("actionDefinitions", data);
      }
    }
  },
});

/**
 * Process a module.install_failed webhook callback from the engine.
 * Emits a transient error event only — no moduleRepository record is created.
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
      .withIndex("by_module_key", (q) => q.eq("moduleKey", correlationKey))
      .first();

    if (record) {
      if (record.archiveKey) {
        await ctx.storage.delete(record.archiveKey as Id<"_storage">);
      }
      const triggers = await ctx.db
        .query("triggerDefinitions")
        .withIndex("by_module", (q) => q.eq("moduleId", record._id))
        .collect();
      for (const trigger of triggers) {
        await ctx.db.delete(trigger._id);
      }
      const actions = await ctx.db
        .query("actionDefinitions")
        .withIndex("by_module", (q) => q.eq("moduleId", record._id))
        .collect();
      for (const action of actions) {
        await ctx.db.delete(action._id);
      }
      await ctx.db.delete(record._id);
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
 * Process a module.delete_failed webhook callback from the engine.
 * The module is still installed on the engine — the moduleRepository record
 * is left untouched. Emits an error transient event carrying the conflict
 * list so the UI can show the user why the delete was refused.
 */
/**
 * Best-effort: the engine sent a delete webhook without a moduleKey, so we
 * can't correlate it directly. Look up the moduleRepository record by name
 * and emit an error transient event under its stored moduleKey so the UI
 * subscription unsticks. If no record is found (or it has no moduleKey),
 * there's no pending UI subscription to notify — log and drop.
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
      .withIndex("by_name_version", (q) => q.eq("name", moduleName))
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
