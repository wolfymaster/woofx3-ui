"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import type { ActionStep, ModuleResourceUsage } from "@woofx3/api";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import { unescapeDollarKeys } from "./lib/dollarKeys";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

interface CreatedInstance {
  canonicalId: string;
  displayName: string;
  instanceId: string;
}

export const createResourceInstance = action({
  args: {
    instanceId: v.id("instances"),
    moduleName: v.string(),
    kind: v.string(),
    resourceInstanceId: v.string(),
    displayName: v.string(),
    // Values for the kind's `schema` fields. The engine keeps them verbatim.
    settings: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (
    ctx,
    { instanceId, moduleName, kind, resourceInstanceId, displayName, settings }
  ): Promise<CreatedInstance> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const result = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).createResourceInstance(moduleName, kind, resourceInstanceId, displayName, settings ?? {});
    return { canonicalId: result.canonicalId, displayName: result.displayName, instanceId: result.instanceId };
  },
});

/**
 * Rename an instance or change the settings it runs with. Identity is fixed, so
 * every workflow, command and widget holding its canonical id keeps working.
 */
export const updateResourceInstance = action({
  args: {
    instanceId: v.id("instances"),
    canonicalId: v.string(),
    displayName: v.string(),
    settings: v.record(v.string(), v.any()),
  },
  handler: async (ctx, { instanceId, canonicalId, displayName, settings }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).updateResourceInstance(canonicalId, displayName, settings);
  },
});

export const deleteResourceInstance = action({
  args: {
    instanceId: v.id("instances"),
    canonicalId: v.string(),
  },
  handler: async (ctx, { instanceId, canonicalId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).deleteResourceInstance(canonicalId);
  },
});

/**
 * Places still using this module's ledger resources (workflows, commands,
 * etc.). Proxies engine `checkModuleResourceUsage` keyed by the installed
 * module's composite `moduleKey`.
 */
export const checkModuleResourceUsage = action({
  args: {
    instanceId: v.id("instances"),
    moduleDbId: v.id("moduleRepository"),
  },
  handler: async (ctx, { instanceId, moduleDbId }): Promise<ModuleResourceUsage[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const module = await ctx.runQuery(internal.moduleRepository.getInternal, { moduleId: moduleDbId });
    if (!module || module.instanceId !== instanceId) {
      throw new Error("Module not found for this instance");
    }
    const moduleKey = module.moduleKey;
    if (!moduleKey) {
      throw new Error("Module is missing moduleKey; reinstall to populate usage data");
    }
    return createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).checkModuleResourceUsage(moduleKey);
  },
});

/**
 * Pull resource instances for one module from the engine and write them into
 * Convex. Fixes the RESOURCES tab when `module_resource_instances` rows exist
 * in Postgres but never arrived via webhook (or arrived with an unresolvable
 * moduleKey).
 */
export const syncResourceInstancesForModule = action({
  args: {
    instanceId: v.id("instances"),
    moduleDbId: v.id("moduleRepository"),
  },
  handler: async (ctx, { instanceId, moduleDbId }): Promise<{ itemsProcessed: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const module = await ctx.runQuery(internal.moduleRepository.getInternal, { moduleId: moduleDbId });
    if (!module || module.instanceId !== instanceId) {
      throw new Error("Module not found for this instance");
    }

    const moduleKey = module.moduleKey ?? "";
    const snapshots = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).listResourceInstancesForModule(moduleKey, module.name);

    return await ctx.runMutation(internal.moduleResourceInstances.reconcileForModule, {
      instanceId,
      moduleId: moduleDbId,
      instances: snapshots.map((snap) => ({
        id: snap.id,
        moduleId: snap.moduleId,
        moduleName: snap.moduleName,
        kind: snap.kind,
        instanceId: snap.instanceId,
        displayName: snap.displayName,
        canonicalId: snap.canonicalId,
        moduleKey: snap.moduleKey || moduleKey,
      })),
    });
  },
});

/**
 * Read the current value of every instance of a kind from the engine into the
 * `resourceValues` mirror. The storage-changed webhook keeps the mirror current
 * after this; a refresh is what fills it for values written before the page
 * was ever opened, or while a webhook went missing.
 */
export const refreshResourceValues = action({
  args: { instanceId: v.id("instances"), kind: v.string() },
  handler: async (ctx, { instanceId, kind }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const rows = await ctx.runQuery(api.moduleResourceInstances.listByKind, { instanceId, kind });
    if (rows.length === 0) {
      return;
    }
    const values = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getResourceValues(rows.map((row) => row.canonicalId));
    await ctx.runMutation(internal.resourceValues.upsertMany, { instanceId, values });
  },
});

/**
 * Run a list of actions on the engine now — the dashboard's way to press a
 * counter's +1 or reset. The engine runs them exactly as a workflow step or a
 * chat command would, and the result reaches the page through the value the
 * actions change, not through this call.
 *
 * `actions` arrive with `$` keys escaped, as every engine JSON crossing Convex
 * does (see lib/dollarKeys.ts).
 */
export const runActions = action({
  args: {
    instanceId: v.id("instances"),
    label: v.string(),
    actions: v.array(v.any()),
  },
  handler: async (ctx, { instanceId, label, actions }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    if (actions.length === 0) {
      throw new Error("runActions: no actions to run");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    await createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).runActions({
      label,
      actions: unescapeDollarKeys(actions) as ActionStep[],
      event: { type: "dashboard.action", source: "dashboard", data: {} },
    });
  },
});
