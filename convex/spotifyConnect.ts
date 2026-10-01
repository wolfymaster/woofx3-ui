import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation } from "./_generated/server";
import { readMemberRole } from "./instances";
import { oauthCallbackUrl } from "./lib/oauthCallback";
import type { OAuthErrorCode } from "./lib/oauthErrors";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { mintOAuthState, oauthStateConfigFromEnv } from "./lib/oauthState";
import { computeCodeChallenge, generateCodeVerifier } from "./lib/pkce";
import { safeRelativePath } from "./lib/safeRedirect";
import { SPOTIFY_INTEGRATION_SCOPES } from "./lib/spotifyIntegrationScopes";
import { claimHandoff } from "./oauthConnectHandoff";

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
    const redirectUri = oauthCallbackUrl("spotify");

    const clientId: string = await ctx.runAction(internal.spotifyIntegration.resolveClientId, {
      instanceId,
      moduleId,
    });

    const state = await mintOAuthState(oauthStateConfigFromEnv());
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
      // Spotify skips its consent screen for an account that authorized this
      // client before; showing it means a connect never completes unseen.
      show_dialog: "true",
    });
    return { authorizeUrl: `https://accounts.spotify.com/authorize?${params}` };
  },
});

export type FinishSpotifyResult = { ok: true; redirectTo: string } | { ok: false; error: OAuthErrorCode };

/** Claims the Spotify result the OAuth callback stored under `codeHash`, for a member of its instance. */
export const claim = internalMutation({
  args: { codeHash: v.string(), userId: v.id("users") },
  handler: async (ctx, { codeHash, userId }) => {
    const claimed = await claimHandoff(ctx, codeHash, "spotify", userId);
    if (!claimed.ok) {
      return { ok: false as const, error: claimed.error };
    }
    const { instanceId, moduleId, redirectTo, spotify } = claimed.row;
    if (!spotify || moduleId === undefined) {
      throw new Error("Spotify handoff without a Spotify result");
    }
    if ((await readMemberRole(ctx, instanceId, userId)) === null) {
      return { ok: false as const, error: "not_permitted" as const };
    }
    return { ok: true as const, instanceId, moduleId, redirectTo, spotify };
  },
});

/**
 * Finishes a module's Spotify connect from the browser that the OAuth
 * callback redirected, with the one-time code it was given. Only the
 * signed-in member who started the connect can finish it.
 */
export const finish = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<FinishSpotifyResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "not_signed_in" };
    }
    if (!isOpaqueToken(code)) {
      return { ok: false, error: "connect_code_invalid" };
    }
    const claimed = await ctx.runMutation(internal.spotifyConnect.claim, {
      codeHash: await hashOpaqueToken(code),
      userId,
    });
    if (!claimed.ok) {
      return { ok: false, error: claimed.error };
    }
    try {
      await ctx.runAction(internal.spotifyIntegration.writeOAuthResult, {
        instanceId: claimed.instanceId,
        moduleId: claimed.moduleId,
        clientId: claimed.spotify.clientId,
        authToken: claimed.spotify.authToken,
        refreshToken: claimed.spotify.refreshToken,
      });
    } catch (err) {
      console.error("[spotify-connect] writing the module settings failed", String(err));
      return { ok: false, error: "engine_write_failed" };
    }
    return { ok: true, redirectTo: claimed.redirectTo };
  },
});
