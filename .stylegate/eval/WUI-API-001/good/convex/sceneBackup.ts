import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import { requireInstanceContext } from "./sceneActions";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";

async function connect(ctx: ActionCtx, instanceId: Id<"instances">): Promise<() => EngineApi> {
  const engine = await requireInstanceContext(ctx, instanceId);
  if (!engine.clientId || !engine.clientSecret) {
    throw new ConvexError("This instance is not registered with its engine yet.");
  }
  const { url, clientId, clientSecret } = engine;
  return () => createEngineRpcSession<EngineApi>(url, clientId, clientSecret);
}

function session(bundle: { url: string; clientId: string; clientSecret: string }): EngineApi {
  return createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
}

export const exportScenes = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const openEngine = await connect(ctx, instanceId);
    return await openEngine().getScenes({});
  },
});

export async function moduleKeys(bundle: { url: string; clientId: string; clientSecret: string }) {
  const modules = await createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret).listEngineModules();
  const { compositions } = await session(bundle).listAlertCompositions();
  return { modules, compositions };
}
