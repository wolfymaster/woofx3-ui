import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import type { ObsSceneListing } from "./lib/obsScenes";

/** `listObsScenes` is not on the shared EngineApi the UI builds against yet. */
interface ObsEngineApi extends EngineApi {
  listObsScenes(): Promise<ObsSceneListing>;
}

/**
 * OBS's scenes and their sources, for the name pickers on the `obs.*` workflow
 * actions. Asked of the engine on every call; the browser keeps a short cache
 * per instance so a form with several OBS fields asks once.
 *
 * Anything short of an answer from the engine is a listing marked unavailable
 * rather than a throw, because the picker falls back to a typed name and has
 * to say why. Only a caller who may not see the instance gets an error.
 */
export const listScenes = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<ObsSceneListing> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, {
      instanceId: args.instanceId,
      userId,
    });
    if (!isMember) {
      throw new Error("Not a member of this instance");
    }
    const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, {
      instanceId: args.instanceId,
    });
    if (!bundle) {
      return { available: false, reason: "the instance is not registered with its engine" };
    }

    try {
      return await createEngineRpcSession<ObsEngineApi>(
        bundle.url,
        bundle.clientId,
        bundle.clientSecret
      ).listObsScenes();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { available: false, reason: `the engine did not answer: ${message}` };
    }
  },
});
