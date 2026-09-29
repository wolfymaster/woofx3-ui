import { getAuthUserId } from "@convex-dev/auth/server";
import type { StorageConfig } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";

export const getConfig = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args): Promise<StorageConfig | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
      internal.workflowCatalogContext.catalogContextForUser,
      {
        instanceId: args.instanceId,
        userId,
      }
    );
    if (!bundle) {
      return null;
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      return null;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      const config: StorageConfig = await rpc.getStorageConfig();
      return config;
    } catch {
      return null;
    }
  },
});

export const setConfig = action({
  args: {
    instanceId: v.id("instances"),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    // Replaces the engine's storage backend and its S3 credentials for
    // everyone on the instance, so it is an owner's or admin's change.
    const userId = await requireInstanceRoleInAction(ctx, args.instanceId, "admin");

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null = await ctx.runQuery(
      internal.workflowCatalogContext.catalogContextForUser,
      {
        instanceId: args.instanceId,
        userId,
      }
    );
    if (!bundle) {
      throw new Error("Not authorized");
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      throw new Error("Instance not registered with engine");
    }

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.setStorageConfig(args.config as unknown as StorageConfig);

    return { success: true };
  },
});
