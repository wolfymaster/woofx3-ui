import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

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
  allowVariants: v.optional(v.boolean()),
  createdByType: v.optional(v.string()),
  createdByRef: v.optional(v.string()),
});

const actionValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  call: v.optional(v.string()),
  paramsSchema: v.optional(v.string()),
  createdByType: v.optional(v.string()),
  createdByRef: v.optional(v.string()),
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
  supportsTiers?: boolean;
  tierLabel?: string;
};

type ActionUiFields = {
  color: string;
  icon: string;
  configFields?: unknown[];
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
 * Pick presentation fields from a parsed configSchema / paramsSchema.
 * Accepts either a bare array (treated as configFields) or an object with
 * top-level keys (or a nested `ui` object). Missing keys are left `undefined`
 * so callers can layer their own defaults.
 */
function pickUi(parsed: unknown): Partial<TriggerUiFields> {
  if (Array.isArray(parsed)) {
    return { configFields: parsed };
  }
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  const nested =
    obj.ui && typeof obj.ui === "object" ? (obj.ui as Record<string, unknown>) : obj;
  return {
    color: typeof nested.color === "string" ? nested.color : undefined,
    icon: typeof nested.icon === "string" ? nested.icon : undefined,
    configFields: Array.isArray(nested.configFields) ? nested.configFields : undefined,
    supportsTiers: typeof nested.supportsTiers === "boolean" ? nested.supportsTiers : undefined,
    tierLabel: typeof nested.tierLabel === "string" ? nested.tierLabel : undefined,
  };
}

function triggerUi(configSchema: string | undefined): TriggerUiFields {
  const picked = pickUi(parseJsonSafe(configSchema));
  return {
    color: picked.color ?? DEFAULT_UI_COLOR,
    icon: picked.icon ?? DEFAULT_TRIGGER_ICON,
    configFields: picked.configFields,
    supportsTiers: picked.supportsTiers,
    tierLabel: picked.tierLabel,
  };
}

function actionUi(paramsSchema: string | undefined): ActionUiFields {
  const picked = pickUi(parseJsonSafe(paramsSchema));
  return {
    color: picked.color ?? DEFAULT_UI_COLOR,
    icon: picked.icon ?? DEFAULT_ACTION_ICON,
    configFields: picked.configFields,
  };
}

type EngineTrigger = {
  id: string;
  category?: string;
  name?: string;
  description?: string;
  event?: string;
  configSchema?: string;
  allowVariants?: boolean;
};

type EngineAction = {
  id: string;
  name?: string;
  description?: string;
  paramsSchema?: string;
};

function translateTrigger(t: EngineTrigger, moduleId: Id<"moduleRepository"> | undefined) {
  const ui = triggerUi(t.configSchema);
  return {
    slug: t.id,
    name: t.name ?? t.id,
    description: t.description ?? "",
    category: t.category ?? "General",
    event: t.event || undefined,
    color: ui.color,
    icon: ui.icon,
    configFields: ui.configFields,
    supportsTiers: ui.supportsTiers,
    tierLabel: ui.tierLabel,
    allowVariants: t.allowVariants,
    moduleId,
  };
}

function translateAction(a: EngineAction, moduleId: Id<"moduleRepository"> | undefined) {
  const ui = actionUi(a.paramsSchema);
  return {
    slug: a.id,
    name: a.name ?? a.id,
    description: a.description ?? "",
    category: DEFAULT_ACTION_CATEGORY,
    color: ui.color,
    icon: ui.icon,
    configFields: ui.configFields,
    moduleId,
  };
}


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
