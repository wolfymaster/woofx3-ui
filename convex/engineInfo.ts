import { getAuthUserId } from "@convex-dev/auth/server";
import type { EngineInfo } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// EngineInfo is "stable for the lifetime of a deployment" (see @woofx3/api), so a
// generous TTL is fine — this only refreshes when an overlay is loaded after the
// window elapses, never on a hot path.
const ENGINE_INFO_TTL_MS = 5 * 60 * 1000;

export const cacheEngineInfo = internalMutation({
  args: {
    instanceId: v.id("instances"),
    streamwareBaseUrl: v.string(),
    engineSceneOverlayBaseUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instanceId, {
      engineStreamwareBaseUrl: args.streamwareBaseUrl,
      engineSceneOverlayBaseUrl: args.engineSceneOverlayBaseUrl,
      engineInfoFetchedAt: Date.now(),
    });
  },
});

export type EngineOverlayInfo = {
  streamwareBaseUrl: string;
  engineSceneOverlayBaseUrl: string;
} | null;

// Returns cached EngineInfo when fresh; otherwise refreshes via a single engine
// RPC and caches it. Returns null when the instance is missing or unregistered.
export const getEngineOverlayInfo = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<EngineOverlayInfo> => {
    const instance = await ctx.runQuery(internal.instances.getInternal, {
      instanceId: args.instanceId,
    });
    if (!instance) {
      return null;
    }

    const fresh =
      instance.engineInfoFetchedAt !== undefined &&
      Date.now() - instance.engineInfoFetchedAt < ENGINE_INFO_TTL_MS &&
      instance.engineSceneOverlayBaseUrl !== undefined;

    if (fresh) {
      return {
        streamwareBaseUrl: instance.engineStreamwareBaseUrl ?? "",
        engineSceneOverlayBaseUrl: instance.engineSceneOverlayBaseUrl ?? "",
      };
    }

    if (!instance.clientId || !instance.clientSecret) {
      return null;
    }

    const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
    const info = await rpc.getEngineInfo();

    await ctx.runMutation(internal.engineInfo.cacheEngineInfo, {
      instanceId: args.instanceId as Id<"instances">,
      streamwareBaseUrl: info.streamwareBaseUrl,
      engineSceneOverlayBaseUrl: info.engineSceneOverlayBaseUrl,
    });

    return {
      streamwareBaseUrl: info.streamwareBaseUrl,
      engineSceneOverlayBaseUrl: info.engineSceneOverlayBaseUrl,
    };
  },
});

// Full EngineInfo for the settings page (unlike getEngineOverlayInfo above, this is
// not cached — it's a single call per settings page visit, not a hot overlay path).
export const getEngineInfo = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<EngineInfo | null> => {
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
      return await rpc.getEngineInfo();
    } catch {
      return null;
    }
  },
});

export const setStreamwareBaseUrl = action({
  args: {
    instanceId: v.id("instances"),
    value: v.string(),
  },
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

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
    return await rpc.setStreamwareBaseUrl(args.value);
  },
});
