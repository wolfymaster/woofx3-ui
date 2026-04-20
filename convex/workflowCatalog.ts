import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import type { CatalogBundle } from "./workflowCatalogContext";
import { loadCatalogBundle } from "./workflowCatalogContext";

function catalogTriggerRow(def: Doc<"triggerDefinitions">, id: string) {
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
    supportsTiers: def.supportsTiers,
    tierLabel: def.tierLabel,
    moduleId: def.moduleId,
  };
}

function catalogActionRow(def: Doc<"actionDefinitions">, id: string) {
  return {
    id,
    name: def.name,
    description: def.description,
    category: def.category,
    color: def.color,
    icon: def.icon,
    configFields: def.configFields,
    moduleId: def.moduleId,
  };
}

type MergedCatalogResponse = {
  triggers: ReturnType<typeof catalogTriggerRow>[];
  actions: ReturnType<typeof catalogActionRow>[];
};

function mergeCatalog(bundle: CatalogBundle): MergedCatalogResponse {
  const triggers = [];
  for (const id of bundle.enabledTriggerIds) {
    const def = bundle.triggerDefs[id];
    if (!def) {
      continue;
    }
    triggers.push(catalogTriggerRow(def, id));
  }

  const actions = [];
  for (const id of bundle.enabledActionIds) {
    const def = bundle.actionDefs[id];
    if (!def) {
      continue;
    }
    actions.push(catalogActionRow(def, id));
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

    return mergeCatalog(bundle);
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
  },
  handler: async (ctx, { instanceId, triggerId }) => {
    const existing = await ctx.db
      .query("instanceEnabledTriggers")
      .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", triggerId))
      .first();
    if (existing) {
      return existing._id;
    }
    return ctx.db.insert("instanceEnabledTriggers", { instanceId, triggerId });
  },
});

export const disableTriggerForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    triggerId: v.string(),
  },
  handler: async (ctx, { instanceId, triggerId }) => {
    const existing = await ctx.db
      .query("instanceEnabledTriggers")
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
  },
  handler: async (ctx, { instanceId, actionId }) => {
    const existing = await ctx.db
      .query("instanceEnabledActions")
      .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", actionId))
      .first();
    if (existing) {
      return existing._id;
    }
    return ctx.db.insert("instanceEnabledActions", { instanceId, actionId });
  },
});

export const disableActionForInstance = internalMutation({
  args: {
    instanceId: v.id("instances"),
    actionId: v.string(),
  },
  handler: async (ctx, { instanceId, actionId }) => {
    const existing = await ctx.db
      .query("instanceEnabledActions")
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
        .query("instanceEnabledTriggers")
        .withIndex("by_instance_trigger", (q) => q.eq("instanceId", instanceId).eq("triggerId", d.slug))
        .first();
      if (!existing) {
        await ctx.db.insert("instanceEnabledTriggers", {
          instanceId,
          triggerId: d.slug,
        });
      }
    }

    const actionDefs = await ctx.db.query("actionDefinitions").collect();
    for (const d of actionDefs) {
      const existing = await ctx.db
        .query("instanceEnabledActions")
        .withIndex("by_instance_action", (q) => q.eq("instanceId", instanceId).eq("actionId", d.slug))
        .first();
      if (!existing) {
        await ctx.db.insert("instanceEnabledActions", {
          instanceId,
          actionId: d.slug,
        });
      }
    }
  },
});
