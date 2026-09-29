import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { type FieldOptionsApi, fieldOptionsReferenceValidator } from "./lib/fieldOptions";

export const dispatch = action({
  args: {
    instanceId: v.id("instances"),
    reference: fieldOptionsReferenceValidator,
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
    const rpc = createEngineRpcSession<FieldOptionsApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    await rpc.dispatchFieldOptionsRequest(args.reference, args.correlationKey);
    return { correlationKey: args.correlationKey };
  },
});
