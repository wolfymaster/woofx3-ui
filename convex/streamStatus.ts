import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const getStreamStatus = query({
  args: {
    instanceId: v.id("instances"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) =>
        q.eq("instanceId", args.instanceId).eq("userId", userId),
      )
      .first();

    if (!membership) {
      return null;
    }

    const instance = await ctx.db.get(args.instanceId);
    if (!instance) {
      return null;
    }

    if (!instance.clientId || !instance.clientSecret) {
      return null;
    }

    try {
      const rpc = createEngineRpcSession<EngineApi>(
        instance.url,
        instance.clientId,
        instance.clientSecret,
      );
      const status = await rpc.getStreamStatus(args.instanceId);
      return status;
    } catch {
      return null;
    }
  },
});
