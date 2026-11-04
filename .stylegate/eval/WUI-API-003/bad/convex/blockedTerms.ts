import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

export const listBlockedTerms = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string[]> => {
    const engine = await ctx.runQuery(internal.instances.getInternal, { instanceId: args.instanceId });
    if (!engine?.clientId || !engine.clientSecret) {
      throw new Error("This instance is not registered with its engine yet.");
    }
    return await createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret).listBlockedTerms();
  },
});
