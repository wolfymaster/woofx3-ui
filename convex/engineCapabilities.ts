import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { type EngineCapabilityReport, fetchEngineCapabilities } from "./lib/engineCapabilities";

/**
 * The features the instance's engine supports; see lib/engineCapabilities.ts.
 * The browser caches the answer per instance and asks again when its engine
 * reconnects, which is when an updated engine would show up.
 */
export const get = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<EngineCapabilityReport> => {
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
    try {
      return await fetchEngineCapabilities({
        url: instance.url,
        clientId: instance.clientId,
        clientSecret: instance.clientSecret,
      });
    } catch (error) {
      throw new ConvexError(
        `Couldn't ask the engine what it supports: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
});
