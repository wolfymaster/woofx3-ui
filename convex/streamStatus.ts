import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import type { StreamStatus } from "@woofx3/api";

export const getStreamStatus = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args): Promise<StreamStatus | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const bundle: { url: string; clientId: string | null; clientSecret: string | null } | null =
      await ctx.runQuery(internal.workflowCatalogContext.catalogContextForUser, {
        instanceId: args.instanceId,
        userId,
      });
    if (!bundle) {
      return null;
    }

    if (!bundle.clientId || !bundle.clientSecret) {
      return null;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
      const status: StreamStatus = await rpc.getStreamStatus(args.instanceId);
      return status;
    } catch {
      return null;
    }
  },
});
