import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

// EngineInfo is "stable for the lifetime of a deployment" (see @woofx3/api), so a
// generous TTL is fine — this only refreshes when an overlay is loaded after the
// window elapses, never on a hot path.
const ENGINE_INFO_TTL_MS = 5 * 60 * 1000;

export const cacheEngineInfo = internalMutation({
  args: {
    instanceId: v.id("instances"),
    widgetAssetBaseUrl: v.string(),
    engineSceneOverlayBaseUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.instanceId, {
      engineWidgetAssetBaseUrl: args.widgetAssetBaseUrl,
      engineSceneOverlayBaseUrl: args.engineSceneOverlayBaseUrl,
      engineInfoFetchedAt: Date.now(),
    });
  },
});

export type EngineOverlayInfo = {
  widgetAssetBaseUrl: string;
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
        widgetAssetBaseUrl: instance.engineWidgetAssetBaseUrl ?? "",
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
      widgetAssetBaseUrl: info.widgetAssetBaseUrl,
      engineSceneOverlayBaseUrl: info.engineSceneOverlayBaseUrl,
    });

    return {
      widgetAssetBaseUrl: info.widgetAssetBaseUrl,
      engineSceneOverlayBaseUrl: info.engineSceneOverlayBaseUrl,
    };
  },
});
