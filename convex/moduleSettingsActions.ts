"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { declaredSettingsOnly } from "./lib/moduleSettingsVisibility";

export interface ModuleSettingValue {
  id: string;
  moduleId: string;
  key: string;
  /** Always empty for a `secret` setting; its value never leaves the engine. */
  value: string;
  valueType: string;
  /** Whether a value is stored — the only way to tell for a `secret` setting. */
  isSet?: boolean;
}

export async function requireEngineInstance(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<{ url: string; clientId: string; clientSecret: string }> {
  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
  if (!instance) {
    throw new Error("Instance not found");
  }
  if (!instance.clientId || !instance.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
}

export const getModuleSettings = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<ModuleSettingValue[]> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const instance = await requireEngineInstance(ctx, instanceId);
    // Separate sessions: a capnweb HTTP batch session is single-use.
    const [result, manifest] = await Promise.all([
      createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).getModuleSettings(
        moduleId
      ),
      createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).getModuleManifest(
        moduleId
      ),
    ]);
    return declaredSettingsOnly(result.settings, manifest);
  },
});

export const updateModuleSetting = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, key, value }): Promise<ModuleSettingValue> => {
    await requireInstanceRoleInAction(ctx, instanceId);
    const instance = await requireEngineInstance(ctx, instanceId);
    // Only a declared setting is the user's to change; the rest is the
    // module's own state or an integration's tokens (see declaredSettingsOnly).
    const manifest = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getModuleManifest(moduleId);
    if (declaredSettingsOnly([{ key }], manifest).length === 0) {
      throw new Error(`"${key}" is not a setting this module declares`);
    }
    return createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).updateModuleSetting(moduleId, key, value);
  },
});
