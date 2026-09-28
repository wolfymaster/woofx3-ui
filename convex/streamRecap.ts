import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import {
  classifyEngineCallError,
  RECAP_LEADERBOARD_LIMIT,
  type StreamRecapEngineApi,
  type StreamRecapEngineDetail,
  toRecapEngineDetail,
} from "./lib/streamRecap";
import { logger } from "./logger";

/**
 * The parts of a stream recap only the engine holds: per-minute viewer samples
 * and who cheered or gifted the most. Totals come from the stored summary
 * instead, so the page renders them even when this call cannot reach the engine.
 */
export const loadEngineDetail = action({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
  },
  handler: async (ctx, { instanceId, sessionId }): Promise<StreamRecapEngineDetail> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
    if (!membership) {
      throw new Error("Not authorized");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      return { status: "unregistered" };
    }
    const { url, clientId, clientSecret } = instance;

    // A capnweb HTTP batch session sends its batch on the first await and is
    // spent after that, so each RPC gets its own session; they still run
    // concurrently.
    const session = () => createEngineRpcSession<StreamRecapEngineApi>(url, clientId, clientSecret);
    try {
      const [gauges, cheerers, gifters] = await Promise.all([
        session().getStreamSessionGauges(sessionId),
        session().getLeaderboard({ metric: "bits", sessionId, limit: RECAP_LEADERBOARD_LIMIT }),
        session().getLeaderboard({ metric: "giftedSubs", sessionId, limit: RECAP_LEADERBOARD_LIMIT }),
      ]);
      return toRecapEngineDetail(gauges, cheerers, gifters);
    } catch (error) {
      const failure = classifyEngineCallError(error);
      logger.warn("stream recap: engine call failed", {
        instanceId,
        sessionId,
        status: failure.status,
        error: error instanceof Error ? error.message : String(error),
      });
      return failure;
    }
  },
});
