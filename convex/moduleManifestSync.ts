"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireEngineInstance } from "./moduleSettingsActions";

/**
 * Fetches the authoritative manifest for a freshly-installed module from the
 * engine and caches it on the moduleRepository record. Runs after every
 * module.installed webhook (see http.ts) regardless of install path — the
 * marketplace flow never has a manifest to hand Convex up front, and this
 * also self-heals any drift for the direct zip-upload flow.
 */
export const syncManifest = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleDbId: v.id("moduleRepository"),
    manifestModuleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleDbId, manifestModuleId }) => {
    const instance = await requireEngineInstance(ctx, instanceId);
    const manifest = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getModuleManifest(manifestModuleId);

    if (manifest === null) {
      return;
    }
    await ctx.runMutation(internal.moduleRepository.setManifest, { moduleId: moduleDbId, manifest });
  },
});
