import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

type InstanceContext = {
  url: string;
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
    throw new Error("Not authorized or instance not found");
  }
  if (!bundle.clientId || !bundle.clientSecret) {
    throw new Error("Instance is not registered with the engine");
  }
  return {
    url: bundle.url,
    clientId: bundle.clientId,
    clientSecret: bundle.clientSecret,
  };
}

/**
 * Play a recorded alert again.
 *
 * The engine re-publishes the stored envelope under a fresh envelope id, so
 * the replay flows through the queue manager as a new dispatch and gets its
 * own row; the original is marked `replayed`. Both changes arrive back here as
 * webhooks, which is why nothing is written to Convex on this path.
 *
 * `replayed: false` means the engine would not replay it -- an id it no longer
 * has, or a payload it cannot parse -- rather than a transport failure, which
 * throws.
 */
export const replay = action({
  args: {
    instanceId: v.id("instances"),
    engineAlertId: v.string(),
  },
  handler: async (ctx, { instanceId, engineAlertId }): Promise<{ replayed: boolean }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const replayed = await rpc.replayAlert(engineAlertId);

    return { replayed };
  },
});
