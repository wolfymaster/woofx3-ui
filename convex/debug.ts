import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

type InstanceContext = {
  url: string;
  applicationId: string;
  clientId: string;
  clientSecret: string;
};

async function requireInstanceContext(ctx: ActionCtx, instanceId: Id<"instances">): Promise<InstanceContext> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
    instanceId,
    userId,
  });
  if (!bundle) {
    throw new Error("Not authorized, instance not found, or instance is not registered with the engine");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    applicationId: bundle.applicationId,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

/**
 * Publish an event onto the engine's NATS bus on a caller-supplied subject,
 * with no `platform` attribute. Used to replay logged engine events
 * (engineEventLog.retrigger), which are not all platform events. Caller is
 * responsible for using a canonical subject string.
 */
export const fireTrigger = action({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    eventData: v.any(),
  },
  handler: async (ctx, { instanceId, eventType, eventData }): Promise<{ success: boolean; message: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return rpc.triggerEvent(eventType, eventData as Record<string, unknown>);
  },
});

/**
 * Inject a synthetic Twitch event. The engine stamps `platform: "twitch"`, so
 * the simulated event is identical to a real one and satisfies
 * `${trigger.platform}` filters that a `fireTrigger` event would not. Used by
 * the /debug page trigger forms.
 */
export const simulateTwitchEvent = action({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    eventData: v.any(),
  },
  handler: async (ctx, { instanceId, eventType, eventData }): Promise<{ success: boolean; message: string }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return rpc.simulateTwitchEvent(eventType, eventData as Record<string, unknown>);
  },
});
