"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireEngineInstance } from "./moduleSettingsActions";

/**
 * The `client_id` to use for a Spotify OAuth attempt: the module's own if it
 * has one set, else this deployment's default app (`SPOTIFY_CLIENT_ID`), or
 * null when there is neither. `spotifyConnect.start` records the one it used in
 * the OAuth state, and the callback exchanges the code with that.
 */
export const resolveClientId = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<string | null> => {
    const instance = await requireEngineInstance(ctx, instanceId);
    const settings = await createEngineRpcSession<EngineApi>(
      instance.url,
      instance.clientId,
      instance.clientSecret
    ).getModuleSettings(moduleId);
    const ownClientId = settings.settings.find((s) => s.key === "clientId")?.value;
    if (ownClientId) {
      return ownClientId;
    }
    return process.env.SPOTIFY_CLIENT_ID || null;
  },
});

/**
 * Persists the result of a completed Spotify OAuth exchange to the module's
 * own settings — clientId (whichever was actually used, even if it's
 * Convex's default), authToken, refreshToken. Each engine RPC call opens its
 * own capnweb session (single-use per CLAUDE.md's constraint).
 */
export const writeOAuthResult = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    clientId: v.string(),
    authToken: v.string(),
    refreshToken: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, clientId, authToken, refreshToken }): Promise<void> => {
    const instance = await requireEngineInstance(ctx, instanceId);
    for (const [key, value] of [
      ["clientId", clientId],
      ["authToken", authToken],
      ["refreshToken", refreshToken],
    ] as const) {
      await createEngineRpcSession<EngineApi>(
        instance.url,
        instance.clientId,
        instance.clientSecret
      ).updateModuleSetting(moduleId, key, value);
    }
  },
});
