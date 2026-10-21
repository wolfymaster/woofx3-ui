import type { RpcTarget } from "@woofx3/api/client";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { type ModuleStorageUsage, moduleStorageUsage } from "./lib/hostedStorage";
import { requireInstanceContext } from "./sceneActions";

// Module storage is what modules keep with `ctx.storage`. On a managed engine
// it lives on the engine's ephemeral disk and is restored from its replica in
// our bucket, so its plan limit (`storage.moduleStorageBytes`) is soft: the
// engine never refuses a write, and this read only feeds the owner's warning.

/**
 * The engine's `getModuleStorageUsage` (capability `modules.storageUsage`), declared here rather than taken from
 * `EngineApi`: CI type-checks against the engine's master, which may predate the method.
 */
interface ModuleStorageUsageApi extends RpcTarget {
  getModuleStorageUsage(): Promise<{ bytes: number }>;
}

/**
 * What the engine's modules keep in module storage against the plan's limit.
 * Null when no limit applies (the engine is not managed) or the engine
 * predates `modules.storageUsage`, which the dashboard shows as unknown.
 */
export const usage = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ModuleStorageUsage | null> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const { hosting, limits } = await ctx.runQuery(internal.hostedStorage.context, { instanceId });
    if (hosting !== "managed") {
      return null;
    }
    const capabilities = await fetchEngineCapabilities(bundle);
    if (!hasEngineCapability(capabilities, "modules.storageUsage")) {
      return null;
    }
    const { bytes } = await createEngineRpcSession<ModuleStorageUsageApi>(
      bundle.url,
      bundle.clientId,
      bundle.clientSecret
    ).getModuleStorageUsage();
    return moduleStorageUsage(bytes, limits);
  },
});
