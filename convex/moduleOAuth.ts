import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, action, internalMutation } from "./_generated/server";
import { readMemberRole } from "./instances";
import { fetchEngineCapabilities, hasEngineCapability } from "./lib/engineCapabilities";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { chooseIntegrationClientId, type IntegrationClientId } from "./lib/integrationClientId";
import {
  type ModuleOAuthIntegration,
  moduleOAuthAuthorizeUrl,
  moduleOAuthStateIntegration,
  readModuleOAuthIntegration,
} from "./lib/moduleOAuth";
import { oauthCallbackUrl } from "./lib/oauthCallback";
import type { OAuthErrorCode } from "./lib/oauthErrors";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { mintOAuthState, oauthStateConfigFromEnv } from "./lib/oauthState";
import { computeCodeChallenge, generateCodeVerifier } from "./lib/pkce";
import { safeRelativePath } from "./lib/safeRedirect";
import { claimHandoff } from "./oauthConnectHandoff";

/**
 * `completeModuleOAuth`, declared here because the engine checkout this repo
 * builds against may predate it. Must match `Woofx3EngineApi`,
 * `ModuleOAuthAuthorization` and `ModuleOAuthConnected` in the engine's
 * `@woofx3/api`.
 */
interface ModuleOAuthEngineApi extends EngineApi {
  completeModuleOAuth(
    moduleId: string,
    integration: string,
    authorization: { code: string; codeVerifier: string; redirectUri: string; clientId?: string; tokenUrl?: string }
  ): Promise<{ connected: true; scope: string[] }>;
}

type EngineCredentials = { url: string; clientId: string; clientSecret: string };

function engineCredentials(instance: Doc<"instances"> | null): EngineCredentials | null {
  if (!instance?.clientId || !instance.clientSecret) {
    return null;
  }
  return { url: instance.url, clientId: instance.clientId, clientSecret: instance.clientSecret };
}

/**
 * The module's declaration of `integration` and the OAuth app a connect of it
 * uses (lib/integrationClientId.ts), or null when the module declares none.
 * The declaration is the engine's installed manifest, the one the engine
 * exchanges the code with.
 */
async function resolveConnect(
  ctx: ActionCtx,
  instance: Doc<"instances">,
  engine: EngineCredentials,
  moduleId: string,
  integration: string
): Promise<{ declared: ModuleOAuthIntegration; app: IntegrationClientId } | null> {
  const module = await ctx.runQuery(internal.moduleRepository.resolveModuleForDetail, {
    instanceId: instance._id,
    moduleId,
  });
  const declared = readModuleOAuthIntegration(module?.manifest, integration);
  if (!declared) {
    return null;
  }
  const { settings } = await createEngineRpcSession<EngineApi>(
    engine.url,
    engine.clientId,
    engine.clientSecret
  ).getModuleSettings(moduleId);
  const app = chooseIntegrationClientId({
    integration: declared,
    moduleClientId: settings.find((s) => s.key === declared.clientIdSetting)?.value,
    hosting: instance.hosting,
    platformClientIds: await ctx.runQuery(internal.integrationCredentials.clientIds, {}),
  });
  return { declared, app };
}

/**
 * Start connecting a module's own OAuth integration (its manifest's
 * `oauth[]`): records who asked in a one-time state and returns the
 * provider's authorize URL for the browser to navigate to. Any member may
 * connect, as any member may edit a module's settings.
 *
 * The client id is the module's own (`clientIdSetting`), or on a managed
 * instance the app woofx3 provides for that provider. The engine keeps the
 * tokens once the connect finishes (`finish`); the dashboard never sees them.
 */
export const start = action({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.string(),
    integration: v.string(),
    redirectTo: v.string(),
  },
  handler: async (ctx, { instanceId, moduleId, integration, redirectTo }): Promise<{ authorizeUrl: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Sign in to connect.");
    }
    const role = await ctx.runQuery(internal.instances.memberRole, { instanceId, userId });
    if (role === null) {
      throw new ConvexError("You are not a member of this instance.");
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    const engine = engineCredentials(instance);
    if (!instance || !engine) {
      throw new ConvexError("This instance is not connected to its engine yet.");
    }
    if (!hasEngineCapability(await fetchEngineCapabilities(engine), "modules.oauth")) {
      throw new ConvexError("Update this engine to connect this module's account.");
    }

    const resolved = await resolveConnect(ctx, instance, engine, moduleId, integration);
    if (!resolved) {
      throw new ConvexError(`This module has no ${integration} connection to set up.`);
    }
    const { declared, app } = resolved;
    if ("missing" in app) {
      throw new ConvexError(
        app.missing === "module_app"
          ? "Enter the app's client ID in this module's settings, then connect again."
          : "This connection is not available yet. Enter your own app's client ID in this module's settings to use it now."
      );
    }
    const { clientId } = app;

    const state = await mintOAuthState(oauthStateConfigFromEnv());
    const codeVerifier = generateCodeVerifier();
    await ctx.runMutation(internal.moduleIntegrationState.storeState, {
      state,
      instanceId,
      moduleId,
      integration: moduleOAuthStateIntegration(integration),
      redirectTo: safeRelativePath(redirectTo, "/modules"),
      userId,
      data: { clientId, codeVerifier },
    });
    return {
      authorizeUrl: moduleOAuthAuthorizeUrl({
        integration: declared,
        clientId,
        redirectUri: oauthCallbackUrl("module"),
        state,
        codeChallenge: await computeCodeChallenge(codeVerifier),
      }),
    };
  },
});

/** Claims the authorization the OAuth callback stored under `codeHash`, for a member of its instance. */
export const claim = internalMutation({
  args: { codeHash: v.string(), userId: v.id("users") },
  handler: async (ctx, { codeHash, userId }) => {
    const claimed = await claimHandoff(ctx, codeHash, "module", userId);
    if (!claimed.ok) {
      return { ok: false as const, error: claimed.error };
    }
    const { instanceId, moduleId, redirectTo, moduleOAuth } = claimed.row;
    if (!moduleOAuth || moduleId === undefined) {
      throw new Error("Module OAuth handoff without its authorization");
    }
    if ((await readMemberRole(ctx, instanceId, userId)) === null) {
      return { ok: false as const, error: "not_permitted" as const };
    }
    return { ok: true as const, instanceId, moduleId, redirectTo, moduleOAuth };
  },
});

export type FinishModuleOAuthResult =
  | { ok: true; redirectTo: string; integration: string }
  | { ok: false; error: OAuthErrorCode };

/**
 * Finishes a module's OAuth connect from the browser the provider redirected,
 * with the one-time code the callback gave it: only the signed-in member who
 * started the connect can finish it. The engine exchanges the authorization
 * and keeps the tokens.
 *
 * The app is chosen again first, so a module updated while the streamer was
 * on the provider's page cannot exchange an authorization of woofx3's app at
 * endpoints the app no longer fits. The engine is told the `tokenUrl` that
 * choice was made for and refuses the exchange if the module changed again
 * since.
 */
export const finish = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<FinishModuleOAuthResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "not_signed_in" };
    }
    if (!isOpaqueToken(code)) {
      return { ok: false, error: "connect_code_invalid" };
    }
    const claimed = await ctx.runMutation(internal.moduleOAuth.claim, {
      codeHash: await hashOpaqueToken(code),
      userId,
    });
    if (!claimed.ok) {
      return { ok: false, error: claimed.error };
    }
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: claimed.instanceId });
    const engine = engineCredentials(instance);
    if (!instance || !engine) {
      return { ok: false, error: "engine_write_failed" };
    }
    const { integration, code: authorizationCode, codeVerifier, redirectUri, clientId } = claimed.moduleOAuth;
    const resolved = await resolveConnect(ctx, instance, engine, claimed.moduleId, integration);
    if (!resolved || !("clientId" in resolved.app) || resolved.app.clientId !== clientId) {
      return { ok: false, error: "invalid_state" };
    }
    try {
      await createEngineRpcSession<ModuleOAuthEngineApi>(
        engine.url,
        engine.clientId,
        engine.clientSecret
      ).completeModuleOAuth(claimed.moduleId, integration, {
        code: authorizationCode,
        codeVerifier,
        redirectUri,
        clientId,
        tokenUrl: resolved.declared.tokenUrl,
      });
    } catch (err) {
      console.error("[module-oauth] the engine could not finish the connect", String(err));
      return { ok: false, error: "token_exchange_failed" };
    }
    return { ok: true, redirectTo: claimed.redirectTo, integration };
  },
});
