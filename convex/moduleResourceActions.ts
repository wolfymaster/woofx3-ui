"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import type { ModuleResourceUsage } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
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
  },
  handler: async (ctx, { instanceId, moduleName, kind, resourceInstanceId, displayName }): Promise<CreatedInstance> => {
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
    ).createResourceInstance(moduleName, kind, resourceInstanceId, displayName);
    return { canonicalId: result.canonicalId, displayName: result.displayName, instanceId: result.instanceId };
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
