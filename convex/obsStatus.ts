import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession } from "./lib/engineInstanceUrl";
import { type ObsStatus, type ObsStatusApi, parseObsStatus } from "./lib/engineObsStatus";

/**
 * How the instance's engine is doing at reaching OBS, for the OBS module's page
 * and the getting started card. Only for an engine with the `obs.status`
 * capability; the browser checks that before asking.
 */
export const get = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<ObsStatus> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Not authenticated");
    }
    const isMember: boolean = await ctx.runQuery(internal.platformRealtime.checkMembership, { instanceId, userId });
    if (!isMember) {
      throw new ConvexError("You are not a member of this instance");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance?.clientId || !instance.clientSecret) {
      throw new ConvexError("This instance is not registered with an engine");
    }
    const raw = await createEngineRpcSession<ObsStatusApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getObsStatus();
    return parseObsStatus(raw);
  },
});
