"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { requireEngineInstance } from "./moduleSettingsActions";

/**
 * The `client_id` to use for a Spotify OAuth attempt: the module's own if
 * it has one set, else Convex's default app. Called identically at both
 * /start (to build the authorize redirect) and /callback (to exchange the
 * code) — re-deriving the same decision at both points instead of trusting
 * a value carried through OAuth state, since nothing here is confidential.
 */
export const resolveClientId = internalAction({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId }): Promise<string> => {
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
    const defaultClientId = process.env.SPOTIFY_CLIENT_ID;
    if (!defaultClientId) {
      throw new Error("SPOTIFY_CLIENT_ID env var is not set");
    }
    return defaultClientId;
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
