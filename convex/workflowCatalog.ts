import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import type { CatalogBundle } from "./workflowCatalogContext";
import { loadCatalogBundle } from "./workflowCatalogContext";

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

function technicalTriggerId(row: Record<string, unknown>): string | null {
  const a = row.id;
  if (typeof a === "string" && a.length > 0) {
    return a;
  }
  const b = row.trigger_id;
  if (typeof b === "string" && b.length > 0) {
    return b;
  }
  return null;
}

function technicalActionId(row: Record<string, unknown>): string | null {
  const a = row.id;
  if (typeof a === "string" && a.length > 0) {
    return a;
  }
  const b = row.action_id;
  if (typeof b === "string" && b.length > 0) {
    return b;
  }
  return null;
}

function byTechnicalId(
  rows: Record<string, unknown>[],
  idFn: (row: Record<string, unknown>) => string | null,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = idFn(row);
    if (id) {
      map.set(id, row);
    }
  }
  return map;
}

function catalogTriggerRow(
  def: Doc<"triggerDefinitions">,
  id: string,
  technical: Record<string, unknown> | null,
) {
  return {
    id,
    technical,
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

function catalogActionRow(
  def: Doc<"actionDefinitions">,
  id: string,
  technical: Record<string, unknown> | null,
) {
  return {
    id,
    technical,
    name: def.name,
    description: def.description,
    category: def.category,
    color: def.color,
    icon: def.icon,
    configFields: def.configFields,
    moduleId: def.moduleId,
  };
}

type MergedCatalogRowTrigger = ReturnType<typeof catalogTriggerRow>;
type MergedCatalogRowAction = ReturnType<typeof catalogActionRow>;
type MergedCatalogEngineMeta = { status: "ok" | "error" | "not_implemented"; message?: string };

type MergedCatalogResponse = {
  triggers: MergedCatalogRowTrigger[];
  actions: MergedCatalogRowAction[];
  engine: MergedCatalogEngineMeta;
};

function mergeCatalog(
  bundle: CatalogBundle,
  engineTriggerMap: Map<string, Record<string, unknown>> | null,
  engineActionMap: Map<string, Record<string, unknown>> | null,
  engineMeta: MergedCatalogEngineMeta,
): MergedCatalogResponse {
  const strictEngine = engineTriggerMap !== null && engineActionMap !== null;

  const triggers = [];
  for (const id of bundle.enabledTriggerIds) {
    const def = bundle.triggerDefs[id];
    if (!def) {
      continue;
    }
    let technical: Record<string, unknown> | null = null;
    if (strictEngine) {
      const row = engineTriggerMap.get(id);
      if (!row) {
        continue;
      }
      technical = row;
    }
    triggers.push(catalogTriggerRow(def, id, technical));
  }

  const actions = [];
  for (const id of bundle.enabledActionIds) {
    const def = bundle.actionDefs[id];
    if (!def) {
      continue;
    }
    let technical: Record<string, unknown> | null = null;
    if (strictEngine) {
      const row = engineActionMap.get(id);
      if (!row) {
        continue;
      }
      technical = row;
    }
    actions.push(catalogActionRow(def, id, technical));
  }

  return { triggers, actions, engine: engineMeta };
}

/**
 * Workflow builder catalog without calling the engine (Convex-only).
 * Use `fetchMerged` when the instance is reachable for technical payloads.
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

    return mergeCatalog(bundle, null, null, { status: "not_implemented" });
  },
});

/**
 * Full catalog: same join + UI merge as `get`, plus engine `getTriggers` / `getActions` over HTTP batch RPC.
 * When the engine call fails, falls back to UI-only rows (`technical` null) like `get`.
 */
export const fetchMerged = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<MergedCatalogResponse> => {
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

    let triggerMap: Map<string, Record<string, unknown>> | null = null;
    let actionMap: Map<string, Record<string, unknown>> | null = null;
    let engineStatus: "ok" | "error" = "ok";
    let engineMessage: string | undefined;

    try {
      if (!bundle.clientId || !bundle.clientSecret) {
        throw new Error("Instance is not registered with the engine");
      }
      const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      const [rawTriggers, rawActions] = await Promise.all([rpc.getTriggers(), rpc.getActions()]);
      triggerMap = byTechnicalId(asObjectArray(rawTriggers), technicalTriggerId);
      actionMap = byTechnicalId(asObjectArray(rawActions), technicalActionId);
    } catch (e) {
      engineStatus = "error";
      engineMessage = e instanceof Error ? e.message : String(e);
    }

    if (engineStatus === "ok") {
      return mergeCatalog(bundle, triggerMap, actionMap, { status: "ok" });
    }

    return mergeCatalog(bundle, null, null, {
      status: "error",
      message: engineMessage,
    });
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
      return asObjectArray(result?.workflows);
    } catch (e) {
      throw new Error(
        `Failed to load workflows: ${e instanceof Error ? e.message : String(e)}`,
      );
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
      .withIndex("by_instance_trigger", (q) =>
        q.eq("instanceId", instanceId).eq("triggerId", triggerId),
      )
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
      .withIndex("by_instance_trigger", (q) =>
        q.eq("instanceId", instanceId).eq("triggerId", triggerId),
      )
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
      .withIndex("by_instance_action", (q) =>
        q.eq("instanceId", instanceId).eq("actionId", actionId),
      )
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
      .withIndex("by_instance_action", (q) =>
        q.eq("instanceId", instanceId).eq("actionId", actionId),
      )
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
        .withIndex("by_instance_trigger", (q) =>
          q.eq("instanceId", instanceId).eq("triggerId", d.slug),
        )
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
        .withIndex("by_instance_action", (q) =>
          q.eq("instanceId", instanceId).eq("actionId", d.slug),
        )
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
