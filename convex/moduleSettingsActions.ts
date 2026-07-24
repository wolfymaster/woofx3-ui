"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export interface ModuleSettingValue {
  id: string;
  moduleId: string;
  key: string;
  value: string;
  valueType: string;
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await requireEngineInstance(ctx, instanceId);
    const result = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getModuleSettings(moduleId);
    return result.settings;
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
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const instance = await requireEngineInstance(ctx, instanceId);
    return createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).updateModuleSetting(moduleId, key, value);
  },
});
