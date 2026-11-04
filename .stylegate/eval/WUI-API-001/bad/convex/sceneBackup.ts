import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { requireInstanceContext } from "./sceneActions";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

async function connect(ctx: ActionCtx, instanceId: Id<"instances">): Promise<EngineApi> {
  const engine = await requireInstanceContext(ctx, instanceId);
  if (!engine.clientId || !engine.clientSecret) {
    throw new ConvexError("This instance is not registered with its engine yet.");
  }
  return createEngineRpcSession<EngineApi>(engine.url, engine.clientId, engine.clientSecret);
}

export const exportScenes = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const engine = await connect(ctx, instanceId);
    return await engine.getScenes({});
  },
});
