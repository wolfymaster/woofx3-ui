import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { type ObsStatus, type ObsStatusApi, parseObsStatus } from "./lib/engineObsStatus";

/**
 * How the instance's engine is doing at reaching OBS, for the OBS module's page
 * and the getting started card.
 */
export const get = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ObsStatus> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }
    const membership = await ctx.runQuery(internal.lib.instanceAccess.usableEngineMembership, { instanceId, userId });
    if (!membership) {
      throw new ConvexError("You don't have access to this woofx3.");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new ConvexError("Your woofx3 isn't set up yet.");
    }
    const raw = await createEngineRpcSession<ObsStatusApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getObsStatus();
    return parseObsStatus(raw);
  },
});
