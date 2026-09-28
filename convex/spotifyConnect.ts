import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { computeCodeChallenge, generateCodeVerifier } from "./lib/pkce";
import { safeRelativePath } from "./lib/safeRedirect";
import { SPOTIFY_INTEGRATION_SCOPES } from "./lib/spotifyIntegrationScopes";

/**
 * Start a module's Spotify OAuth flow: records who asked in a one-time state
 * and returns Spotify's authorize URL for the browser to navigate to.
 *
 * Minting the state behind authentication is what ties the callback to a
 * member of the instance; the HTTP callback accepts no other state. Any member
 * may connect, as any member may edit a module's settings: the tokens land in
 * that one module's settings and move nothing else on the instance.
 *
 * Kept out of spotifyIntegration.ts, which runs under `"use node"`, so PKCE
 * uses the same Web Crypto runtime the rest of the OAuth code does.
 */
export const start = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    redirectTo: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, redirectTo }): Promise<{ authorizeUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const role = await ctx.runQuery(internal.instances.memberRole, { instanceId, userId });
    if (role === null) {
      throw new Error("Not a member of this instance");
    }
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
    if (!redirectUri) {
      throw new Error("SPOTIFY_REDIRECT_URI env var is not set");
    }

    const clientId: string = await ctx.runAction(internal.spotifyIntegration.resolveClientId, {
      instanceId,
      moduleId,
    });

    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await computeCodeChallenge(codeVerifier);

    await ctx.runMutation(internal.moduleIntegrationState.storeState, {
      state,
      instanceId,
      moduleId,
      integration: "spotify",
      redirectTo: safeRelativePath(redirectTo, "/modules"),
      userId,
      data: { clientId, codeVerifier },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SPOTIFY_INTEGRATION_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return { authorizeUrl: `https://accounts.spotify.com/authorize?${params}` };
  },
});
