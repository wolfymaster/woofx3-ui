import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, type QueryCtx, query } from "./_generated/server";
import { canonicalRefFromProjectionKey } from "./lib/canonicalRef";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import type { CatalogBundle } from "./workflowCatalogContext";
import { loadCatalogBundle } from "./workflowCatalogContext";

function catalogTriggerRow(def: Doc<"triggerDefinitions">, id: string, moduleName: string | undefined) {
  return {
    id,
    name: def.name,
    description: def.description,
    category: def.category,
    color: def.color,
    icon: def.icon,
    event: def.event,
    allowVariants: def.allowVariants,
    configFields: def.configFields,
    projectionKey: def.projectionKey,
    canonicalRef: canonicalRefFromProjectionKey(def.projectionKey, "trigger"),
    moduleId: def.moduleId,
    moduleName,
  };
}

function catalogActionRow(def: Doc<"actionDefinitions">, id: string, moduleName: string | undefined) {
  return {
    id,
    name: def.name,
    description: def.description,
    category: def.category,
    color: def.color,
    icon: def.icon,
    configFields: def.configFields,
    outputFields: def.outputFields,
    projectionKey: def.projectionKey,
    canonicalRef: canonicalRefFromProjectionKey(def.projectionKey, "action"),
    handlerType: def.handlerType,
    functionCall: def.functionCall,
    moduleId: def.moduleId,
    moduleName,
  };
}

type MergedCatalogResponse = {
  triggers: ReturnType<typeof catalogTriggerRow>[];
  actions: ReturnType<typeof catalogActionRow>[];
};

// Resource_ref fields (e.g. Increment Counter's "Counter" picker) need the
// owning module's engine-facing identifier to create new instances, so it's
// resolved here once per distinct moduleId rather than round-tripped by the
// client. This is the manifest id (moduleKey's first segment, e.g. "counter"),
// not moduleRepository.name (a display name, e.g. "Counter") — same
// derivation as formatInstalledDetail in moduleDetail.ts.
async function resolveModuleNames(
  ctx: QueryCtx,
  moduleIds: (Id<"moduleRepository"> | undefined)[]
): Promise<Map<Id<"moduleRepository">, string>> {
  const uniqueIds = Array.from(new Set(moduleIds.filter((id): id is Id<"moduleRepository"> => id !== undefined)));
  const names = new Map<Id<"moduleRepository">, string>();
  for (const moduleId of uniqueIds) {
    const module = await ctx.db.get(moduleId);
    if (module) {
      names.set(moduleId, module.moduleKey?.split(":")[0] ?? module.name);
    }
  }
  return names;
}

async function mergeCatalog(ctx: QueryCtx, bundle: CatalogBundle): Promise<MergedCatalogResponse> {
  const triggerDefs = bundle.enabledTriggerIds.map((id) => bundle.triggerDefs[id]).filter((def) => !!def);
  const actionDefs = bundle.enabledActionIds.map((id) => bundle.actionDefs[id]).filter((def) => !!def);
  const moduleNames = await resolveModuleNames(
    ctx,
    [...triggerDefs, ...actionDefs].map((def) => def.moduleId)
  );

  const triggers = [];
  for (const id of bundle.enabledTriggerIds) {
    const def = bundle.triggerDefs[id];
    if (!def) {
      continue;
    }
    triggers.push(catalogTriggerRow(def, id, def.moduleId ? moduleNames.get(def.moduleId) : undefined));
  }

  const actions = [];
  for (const id of bundle.enabledActionIds) {
    const def = bundle.actionDefs[id];
    if (!def) {
      continue;
    }
    actions.push(catalogActionRow(def, id, def.moduleId ? moduleNames.get(def.moduleId) : undefined));
  }

  return { triggers, actions };
}

/**
 * Workflow builder catalog. Convex is the UI's source of truth — kept in sync
 * with the engine via module webhook callbacks (module.installed / module.deleted
 * / module.trigger.registered / module.action.registered).
 */
export const get = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const bundle = await loadCatalogBundle(ctx, userId, instanceId);
    if (!bundle) {
      return null;
    }

    return mergeCatalog(ctx, bundle);
  },
});

/**
 * Fetch the workflow list from the engine, proxied through Convex.
 * Returns the workflow array on success or throws a ConvexError on failure.
 */
export const listWorkflows = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Record<string, unknown>[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId,
      userId,
    });
    if (!bundle) {
      throw new Error("Not authorized or instance not found");
    }

    try {
      if (!bundle.clientId || !bundle.clientSecret) {
        throw new Error("Instance is not registered with the engine");
      }
      const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      const result = await rpc.getWorkflows({ accountId: instanceId });
      const workflows = result?.workflows;
      if (!Array.isArray(workflows)) {
        return [];
      }
      return workflows as unknown as Record<string, unknown>[];
    } catch (e) {
      throw new Error(`Failed to load workflows: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
});

export const enableTriggerForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    triggerId: v.string(),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, triggerId, createdByType, createdByRef }) => {
    const existing = await ctx.db
      .query("instanceTriggers")
      .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", triggerId))
      .first();
    if (existing) {
      if (createdByRef && existing.createdByRef !== createdByRef) {
        await ctx.db.patch(existing._id, { createdByType, createdByRef });
      }
      return existing._id;
    }
    return ctx.db.insert("instanceTriggers", { instanceId, triggerId, createdByType, createdByRef });
  },
});

export const disableTriggerForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    triggerId: v.string(),
  },
  handler: async (ctx, { instanceId, triggerId }) => {
    const existing = await ctx.db
      .query("instanceTriggers")
      .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", triggerId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const enableActionForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    actionId: v.string(),
    createdByType: v.optional(v.string()),
    createdByRef: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, actionId, createdByType, createdByRef }) => {
    const existing = await ctx.db
      .query("instanceActions")
      .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", actionId))
      .first();
    if (existing) {
      if (createdByRef && existing.createdByRef !== createdByRef) {
        await ctx.db.patch(existing._id, { createdByType, createdByRef });
      }
      return existing._id;
    }
    return ctx.db.insert("instanceActions", { instanceId, actionId, createdByType, createdByRef });
  },
});

export const disableActionForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    actionId: v.string(),
  },
  handler: async (ctx, { instanceId, actionId }) => {
    const existing = await ctx.db
      .query("instanceActions")
      .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", actionId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Dev convenience: enable every trigger/action definition on an instance (idempotent).
 * Remove or gate when module install wires join rows.
 */
export const devEnableAllDefinitionsForInstance = internalMutation({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const triggerDefs = await ctx.db.query("triggerDefinitions").collect();
    for (const d of triggerDefs) {
      const existing = await ctx.db
        .query("instanceTriggers")
        .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", d.slug))
        .first();
      if (!existing) {
        await ctx.db.insert("instanceTriggers", { instanceId, triggerId: d.slug });
      }
    }

    const actionDefs = await ctx.db.query("actionDefinitions").collect();
    for (const d of actionDefs) {
      const existing = await ctx.db
        .query("instanceActions")
        .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", d.slug))
        .first();
      if (!existing) {
        await ctx.db.insert("instanceActions", { instanceId, actionId: d.slug });
      }
    }
  },
});
