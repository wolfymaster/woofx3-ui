import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

const descriptorValidator = v.object({
  kind: v.literal("internal"),
  request: v.object({
    event: v.string(),
    payload: v.optional(v.any()),
  }),
  timeoutMs: v.optional(v.number()),
});

export const dispatch = action({
  args: {
    instanceId: v.id("instances"),
    descriptor: descriptorValidator,
    correlationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const bundle = await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
      instanceId: args.instanceId,
      userId,
    });
    if (!bundle?.clientId || !bundle.clientSecret) {
      throw new Error("Instance is not registered with the engine");
    }
    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.dispatchFieldOptionsRequest(args.descriptor, args.correlationKey);
    return { correlationKey: args.correlationKey };
  },
});
