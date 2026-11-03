import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, query } from "./_generated/server";
import { requireInstanceContext } from "./sceneActions";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const myMemberships = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    return ctx.db
      .query("instanceMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(50);
  },
});

export const listBlockedTerms = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string[]> => {
    const engine = await requireInstanceContext(ctx, args.instanceId);
    return await createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret).listBlockedTerms();
  },
});
