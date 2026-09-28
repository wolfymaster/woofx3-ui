import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
import {
  type AlertClearResult,
  type AlertQueueEngineApi,
  type AlertReplayResult,
  type AlertSkipResult,
  readClearResult,
  readReplayResult,
  readSkipResult,
} from "./lib/alertQueueResults";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";

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
 * The engine re-dispatches the stored envelope under a fresh envelope id to
 * every open overlay, records it as a new row and marks the original
 * `replayed`. Both changes arrive back here as webhooks, which is why nothing
 * is written to Convex on this path.
 *
 * `ok: false` is the engine declining with a `reason` (no overlay is open, the
 * scene manager did not answer, an id it no longer has); a transport failure
 * throws.
 */
export const replay = action({
  args: {
    instanceId: v.id("instances"),
    engineAlertId: v.string(),
  },
  handler: async (ctx, { instanceId, engineAlertId }): Promise<AlertReplayResult> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<AlertQueueEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return readReplayResult(await rpc.replayAlert(engineAlertId));
  },
});

/**
 * End the alert playing on every open overlay and let the next one start.
 *
 * The skipped row and the next dispatch both arrive back as webhooks, so
 * nothing is written to Convex here. `skipped: 0` with `ok` means nothing was
 * playing, an answer rather than an error.
 */
export const skipCurrent = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, { instanceId }): Promise<AlertSkipResult> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<AlertQueueEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return readSkipResult(await rpc.skipCurrentAlert());
  },
});

/**
 * Drop every alert still waiting on every open overlay. The one playing now
 * keeps playing; pair with `skipCurrent` to silence the overlay entirely.
 *
 * Returns how many were dropped. The rows turn `skipped` through webhooks.
 */
export const clearQueue = action({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, { instanceId }): Promise<AlertClearResult> => {
    const bundle = await requireInstanceContext(ctx, instanceId);

    const rpc = createEngineRpcSession<AlertQueueEngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    return readClearResult(await rpc.clearAlertQueue());
  },
});
