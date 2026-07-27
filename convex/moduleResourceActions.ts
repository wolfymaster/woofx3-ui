"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
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
