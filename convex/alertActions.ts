import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

/**
 * The engine's operator controls over its alert queue.
 *
 * Must match `skipCurrentAlert` / `clearAlertQueue` on `Woofx3EngineApi` in
 * the engine's shared/clients/typescript/api/api.ts.
 */
interface AlertQueueControlsApi {
  skipCurrentAlert(): Promise<{ skipped: boolean }>;
  clearAlertQueue(): Promise<{ cleared: number }>;
}

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

/**
 * Stop the alert that is playing now and let the queue move on to the next.
 *
 * The skipped row and the next dispatch both arrive back as webhooks, so
 * nothing is written to Convex here. `skipped: false` means nothing was in
 * flight, which is an answer rather than an error.
 */
export const skipCurrent = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, { instanceId }): Promise<{ skipped: boolean }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<EngineApi & AlertQueueControlsApi>(
      bundle.url,
      bundle.clientId,
      bundle.clientSecret
    );
    const result = await rpc.skipCurrentAlert();

    return { skipped: result.skipped === true };
  },
});

/**
 * Drop every alert still waiting in the queue. The one playing now keeps
 * playing; pair with `skipCurrent` to silence the overlay entirely.
 *
 * Returns how many were dropped. The rows turn `skipped` through webhooks.
 */
export const clearQueue = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, { instanceId }): Promise<{ cleared: number }> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<EngineApi & AlertQueueControlsApi>(
      bundle.url,
      bundle.clientId,
      bundle.clientSecret
    );
    const result = await rpc.clearAlertQueue();
    if (!Number.isInteger(result.cleared) || result.cleared < 0) {
      throw new Error(`Engine answered clearAlertQueue with an invalid count: ${String(result.cleared)}`);
    }

    return { cleared: result.cleared };
  },
});
