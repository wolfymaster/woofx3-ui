import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
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
    try {
      await rpc.dispatchFieldOptionsRequest(args.reference, args.correlationKey);
    } catch (error) {
      // A production deployment replaces a plain Error's message with "Server
      // Error"; the engine's refusal (module not installed, no such field) is
      // what the picker and the go live OBS check show and tell apart.
      throw new ConvexError(error instanceof Error ? error.message : String(error));
    }
    return { correlationKey: args.correlationKey };
  },
});
