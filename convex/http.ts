import type { InboundWebhookResponse } from "@woofx3/api";
import type { CallbackEnvelope, CallbackEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { buildBrowserSourcePlaceholderHtml, buildBrowserSourceRedirect } from "./lib/browserSourceHtml";
import { escapeDollarKeys } from "./lib/dollarKeys";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { parseInboundWebhookPath } from "./lib/inboundWebhookPath";
import {
  buildForwardedRequest,
  EngineTimeoutError,
  MAX_INBOUND_BODY_BYTES,
  toHttpResponse,
  withEngineTimeout,
} from "./lib/inboundWebhookRelay";
import { SIGNATURE_HEADER, verifySignature } from "./lib/maintenanceSignature";
import { computeCodeChallenge, generateCodeVerifier } from "./lib/pkce";
import { isCurrentSceneUrl } from "./lib/sceneOverlayUrl";
import { SPOTIFY_INTEGRATION_SCOPES } from "./lib/spotifyIntegrationScopes";
import { TWITCH_INTEGRATION_SCOPES } from "./lib/twitchIntegrationScopes";
import { widgetCanonicalKey } from "./lib/widgetKey";
import { logger } from "./logger";
import { canonicalIdForStorageKey } from "./resourceValues";
import "./browserSource";
import "./obsCommands";
import "./moduleWebhook";

const http = httpRouter();

const CORS_HEADERS: Record<string, string> =
  process.env.CORS_ENABLED === "true"
    ? {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      }
    : {};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

const preflightHandler = httpAction(async () => {
  if (process.env.CORS_ENABLED !== "true") {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 204, headers: CORS_HEADERS });
});

// Registers /.well-known/jwks.json, /.well-known/openid-configuration, and
// Password provider routes. Must come before custom routes.
auth.addHttpRoutes(http);

function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) throw new Error(`[twitch-oauth] ASSERT FAILED: ${msg}`);
}

function errorRedirect(siteUrl: string, step: string, detail: string) {
  const msg = encodeURIComponent(`${step}: ${detail}`);
  logger.error("oauth step failed", { step, detail });
  return new Response(null, {
    status: 302,
    headers: { Location: `${siteUrl}/auth/login?error=${msg}` },
  });
}

http.route({
  path: "/api/auth/twitch/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.AUTH_TWITCH_ID, "AUTH_TWITCH_ID env var is not set");
    assert(process.env.AUTH_TWITCH_REDIRECT_URI, "AUTH_TWITCH_REDIRECT_URI env var is not set");

    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirect_to") ?? "/";
    const state = crypto.randomUUID();

    await ctx.runMutation(internal.twitchAuth.storeState, { state, redirectTo });

    const params = new URLSearchParams({
      client_id: process.env.AUTH_TWITCH_ID,
      redirect_uri: process.env.AUTH_TWITCH_REDIRECT_URI,
      response_type: "code",
      scope: "user:read:email",
      state,
    });

    logger.info("redirecting to twitch", { state, redirectTo });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://id.twitch.tv/oauth2/authorize?${params}` },
    });
  }),
});

http.route({
  path: "/api/auth/twitch/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.SITE_URL, "SITE_URL env var is not set");
    assert(process.env.AUTH_TWITCH_ID, "AUTH_TWITCH_ID env var is not set");
    assert(process.env.AUTH_TWITCH_SECRET, "AUTH_TWITCH_SECRET env var is not set");
    assert(process.env.AUTH_TWITCH_REDIRECT_URI, "AUTH_TWITCH_REDIRECT_URI env var is not set");

    const siteUrl = process.env.SITE_URL;
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    logger.info("callback received", { hasCode: !!code, hasState: !!state });

    if (!code || !state) {
      return errorRedirect(siteUrl, "missing_params", `code=${!!code} state=${!!state}`);
    }

    const stateResult = await ctx.runMutation(internal.twitchAuth.validateAndConsumeState, { state });
    if (!stateResult) {
      return errorRedirect(siteUrl, "invalid_state", "state not found or expired");
    }
    const { redirectTo, instanceId } = stateResult;

    logger.info("state valid, exchanging code", { isIntegration: !!instanceId });

    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_TWITCH_ID,
        client_secret: process.env.AUTH_TWITCH_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.AUTH_TWITCH_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return errorRedirect(siteUrl, "token_exchange_failed", `HTTP ${tokenRes.status}: ${body}`);
    }

    const tokenData = await tokenRes.json();
    assert(tokenData.access_token, `no access_token in response: ${JSON.stringify(tokenData)}`);
    logger.info("token exchange ok");

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Client-Id": process.env.AUTH_TWITCH_ID,
      },
    });

    if (!userRes.ok) {
      const body = await userRes.text();
      return errorRedirect(siteUrl, "profile_fetch_failed", `HTTP ${userRes.status}: ${body}`);
    }

    const { data } = await userRes.json();
    assert(data?.length > 0, "Twitch returned empty user data");
    const twitchUser = data[0];
    logger.info("got twitch user", { login: twitchUser.login, id: twitchUser.id });

    if (instanceId) {
      const expiresAt = Date.now() + tokenData.expires_in * 1000;
      const scopes = Array.isArray(tokenData.scope) ? tokenData.scope : tokenData.scope.split(" ");

      await ctx.runMutation(internal.twitchIntegration.upsertPlatformLink, {
        instanceId,
        platform: "twitch",
        platformUserId: twitchUser.id,
        platformUsername: twitchUser.display_name || twitchUser.login,
        profileImageUrl: twitchUser.profile_image_url ?? undefined,
        channelId: twitchUser.id,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scopes,
      });

      try {
        await ctx.runAction(internal.twitchIntegration.syncToEngine, { instanceId });
        logger.info("engine sync completed for integration");
      } catch (err) {
        logger.error("engine sync failed for integration", { error: String(err) });
      }

      const dest = `${siteUrl}/auth/twitch/callback?mode=connect&redirect_to=${encodeURIComponent(redirectTo)}`;
      logger.info("redirecting to frontend after integration", { dest });
      return new Response(null, {
        status: 302,
        headers: { Location: dest },
      });
    }

    const token = await ctx.runMutation(internal.twitchAuth.storePendingAuth, {
      twitchId: twitchUser.id,
      displayName: twitchUser.display_name,
      email: twitchUser.email ?? "",
      profileImage: twitchUser.profile_image_url ?? "",
    });

    const dest = `${siteUrl}/auth/twitch/callback?token=${token}&redirect_to=${encodeURIComponent(redirectTo)}`;
    logger.info("redirecting to frontend", { dest });
    return new Response(null, {
      status: 302,
      headers: { Location: dest },
    });
  }),
});

http.route({
  path: "/api/integrations/twitch/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.AUTH_TWITCH_ID, "AUTH_TWITCH_ID env var is not set");
    assert(process.env.AUTH_TWITCH_REDIRECT_URI, "AUTH_TWITCH_REDIRECT_URI env var is not set");

    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const redirectTo = url.searchParams.get("redirect_to") ?? "/settings?tab=integrations";
    const state = crypto.randomUUID();

    if (!instanceId) {
      return errorRedirect(process.env.SITE_URL ?? "", "missing_params", "instanceId is required");
    }

    await ctx.runMutation(internal.twitchAuth.storeState, {
      state,
      redirectTo,
      instanceId: instanceId as Id<"instances">,
    });

    const params = new URLSearchParams({
      client_id: process.env.AUTH_TWITCH_ID,
      redirect_uri: process.env.AUTH_TWITCH_REDIRECT_URI,
      response_type: "code",
      scope: TWITCH_INTEGRATION_SCOPES.join(" "),
      state,
    });

    logger.info("redirecting to twitch for integration", { state, redirectTo, instanceId });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://id.twitch.tv/oauth2/authorize?${params}` },
    });
  }),
});

function moduleIntegrationErrorRedirect(
  siteUrl: string,
  redirectTo: string,
  integration: string,
  message: string
): Response {
  logger.error("module integration oauth failed", { integration, message });
  const params = new URLSearchParams({ integration, status: "error", message });
  return new Response(null, {
    status: 302,
    headers: { Location: `${siteUrl}${redirectTo}?${params}` },
  });
}

http.route({
  path: "/api/integrations/spotify/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.SPOTIFY_REDIRECT_URI, "SPOTIFY_REDIRECT_URI env var is not set");
    const siteUrl = process.env.SITE_URL ?? "";

    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const moduleId = url.searchParams.get("moduleId");
    const redirectTo = url.searchParams.get("redirect_to") ?? "/modules";

    if (!instanceId || !moduleId) {
      return moduleIntegrationErrorRedirect(siteUrl, redirectTo, "spotify", "instanceId and moduleId are required");
    }

    let clientId: string;
    try {
      clientId = await ctx.runAction(internal.spotifyIntegration.resolveClientId, {
        instanceId: instanceId as Id<"instances">,
        moduleId,
      });
    } catch (err) {
      return moduleIntegrationErrorRedirect(
        siteUrl,
        redirectTo,
        "spotify",
        err instanceof Error ? err.message : String(err)
      );
    }

    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await computeCodeChallenge(codeVerifier);

    await ctx.runMutation(internal.moduleIntegrationState.storeState, {
      state,
      instanceId: instanceId as Id<"instances">,
      moduleId,
      integration: "spotify",
      redirectTo,
      data: { clientId, codeVerifier },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
      scope: SPOTIFY_INTEGRATION_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    logger.info("redirecting to spotify for integration", { state, redirectTo, instanceId, moduleId });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://accounts.spotify.com/authorize?${params}` },
    });
  }),
});

http.route({
  path: "/api/integrations/spotify/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.SPOTIFY_REDIRECT_URI, "SPOTIFY_REDIRECT_URI env var is not set");
    const siteUrl = process.env.SITE_URL ?? "";

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      // No redirectTo is known without a valid state row — /modules is the
      // best available fallback destination.
      return moduleIntegrationErrorRedirect(siteUrl, "/modules", "spotify", "missing code or state");
    }

    const stateResult = await ctx.runMutation(internal.moduleIntegrationState.validateAndConsumeState, { state });
    if (!stateResult || stateResult.integration !== "spotify") {
      return moduleIntegrationErrorRedirect(siteUrl, "/modules", "spotify", "state not found or expired");
    }
    const { instanceId, moduleId, redirectTo, data } = stateResult;
    const { clientId, codeVerifier } = (data ?? {}) as { clientId?: string; codeVerifier?: string };
    if (!clientId || !codeVerifier) {
      return moduleIntegrationErrorRedirect(siteUrl, redirectTo, "spotify", "malformed OAuth state");
    }

    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return moduleIntegrationErrorRedirect(
        siteUrl,
        redirectTo,
        "spotify",
        `token exchange failed: HTTP ${tokenRes.status}: ${body}`
      );
    }

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token || !tokenData.refresh_token) {
      return moduleIntegrationErrorRedirect(
        siteUrl,
        redirectTo,
        "spotify",
        `no access_token/refresh_token in token response: ${JSON.stringify(tokenData)}`
      );
    }

    try {
      await ctx.runAction(internal.spotifyIntegration.writeOAuthResult, {
        instanceId,
        moduleId,
        clientId,
        authToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      });
    } catch (err) {
      return moduleIntegrationErrorRedirect(
        siteUrl,
        redirectTo,
        "spotify",
        err instanceof Error ? err.message : String(err)
      );
    }

    logger.info("spotify integration connected", { instanceId, moduleId });
    return new Response(null, {
      status: 302,
      headers: { Location: `${siteUrl}${redirectTo}?integration=spotify&status=connected` },
    });
  }),
});

http.route({ path: "/api/webhooks/woofx3/alerts", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3/alerts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    logger.info("webhook: alerts endpoint hit", {
      eventType: payload.eventType,
      instanceId: payload.instanceId,
      user: payload.user,
    });

    if (!payload.instanceId || !payload.eventType || !payload.user) {
      logger.warn("webhook: alerts missing required fields", {
        hasInstanceId: !!payload.instanceId,
        hasEventType: !!payload.eventType,
        hasUser: !!payload.user,
      });
      return corsJson({ error: "Missing required fields" }, 400);
    }

    const instanceId = payload.instanceId as string;
    const scene = await ctx.runQuery(internal.browserSource.getDefaultScene, { instanceId });

    if (!scene) {
      return corsJson({ error: "No scene found for instance" }, 404);
    }

    const now = Date.now();
    const alertDescriptor = await ctx.runQuery(internal.browserSource.getAlertDescriptor, {
      sceneId: scene._id,
      alertType: payload.eventType,
    });

    const ttl = alertDescriptor?.ttl ?? 300;
    const priority = alertDescriptor?.priority ?? 0;

    const alertId = await ctx.runMutation(internal.browserSource.createAlert, {
      instanceId: scene.instanceId,
      sceneId: scene._id,
      sourceKey: payload.sourceKey ?? "",
      alertType: payload.eventType,
      user: payload.user,
      amount: payload.amount,
      message: payload.message,
      tier: payload.tier,
      rawPayload: payload,
      priority,
      ttl,
      expiresAt: now + ttl * 1000,
    });

    return corsJson({ success: true, alertId });
  }),
});

function extractApplicationId(event: unknown): string | undefined {
  if (event && typeof event === "object" && "applicationId" in event) {
    const value = (event as { applicationId?: unknown }).applicationId;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

http.route({ path: "/api/webhooks/woofx3", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    logger.info("webhook: incoming request", {
      type: payload.type,
      url: request.url,
    });

    if (!payload.type) {
      logger.warn("webhook: missing type field", { payload: JSON.stringify(payload) });
      return corsJson({ error: "Missing required field: type" }, 400);
    }

    // Validate webhook secret (callbackToken) via Bearer token
    const authHeader = request.headers.get("Authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");
    if (!providedSecret) {
      logger.warn("webhook: missing Authorization header");
      return corsJson({ error: "Missing Authorization header" }, 401);
    }

    // Look up instance by webhook secret
    const instance = await ctx.runQuery(internal.instances.getByWebhookSecret, {
      webhookSecret: providedSecret,
    });
    if (!instance) {
      logger.warn("webhook: unauthorized - no instance found for provided secret");
      return corsJson({ error: "Unauthorized" }, 401);
    }

    // Envelope shape is @woofx3/api/webhooks CallbackEnvelope; `data` is the
    // discriminated CallbackEvent union. We trust the engine's contract and
    // narrow by event.type — anything outside the union falls through to
    // `handled: false` so legacy or future event types are safe to ignore.
    //
    // Escape $‑prefixed keys before dispatching — the engine embeds `$ref`
    // inside workflow definitions and Convex rejects reserved field names.
    const envelope = payload as CallbackEnvelope;
    const event = escapeDollarKeys(envelope.data) as CallbackEvent;
    const eventType = event?.type ?? (payload.type as string | undefined) ?? "";

    logger.info("webhook: event received", {
      instanceId: instance._id,
      type: eventType,
      payload: JSON.stringify(payload),
    });

    await ctx.runMutation(internal.engineEventLog.record, {
      instanceId: instance._id,
      applicationId: extractApplicationId(envelope.data),
      eventType,
      payload: JSON.stringify(envelope.data ?? null),
      envelopeId: typeof envelope.id === "string" ? envelope.id : undefined,
      engineEventTime: typeof envelope.time === "string" ? envelope.time : undefined,
    });

    if (!event || typeof event !== "object" || !event.type) {
      logger.warn("webhook: envelope missing typed data", {
        eventType,
        hasData: !!payload.data,
      });
      return corsJson({ success: true, type: eventType, handled: false });
    }

    switch (event.type) {
      case EngineEventType.MODULE_INSTALLED: {
        const moduleDbId = await ctx.runMutation(internal.moduleWebhook.processModuleInstalled, {
          instanceId: instance._id,
          correlationKey: event.moduleKey,
          moduleName: event.moduleName,
          moduleVersion: event.version,
          // module.installed carries no definitions — those arrive on
          // separate module.trigger.registered / module.action.registered
          // events.
          triggers: [],
          actions: [],
        });
        // Neither install path (marketplace or direct zip upload) reliably has
        // the manifest in hand at this point, so fetch the engine's
        // authoritative copy out-of-band rather than block the webhook response.
        await ctx.scheduler.runAfter(0, internal.moduleManifestSync.syncManifest, {
          instanceId: instance._id,
          moduleDbId,
          manifestModuleId: event.moduleKey.split(":")[0],
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_INSTALL_FAILED: {
        await ctx.runMutation(internal.moduleWebhook.processModuleInstallFailed, {
          instanceId: instance._id,
          correlationKey: event.moduleKey,
          moduleName: event.moduleName,
          moduleVersion: event.version,
          statusMessage: event.error || "Module installation failed on the engine.",
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_DELETED: {
        await ctx.runMutation(internal.moduleWebhook.processModuleDeleted, {
          instanceId: instance._id,
          correlationKey: event.moduleKey,
          moduleName: event.moduleName,
          moduleVersion: undefined,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_DELETE_FAILED: {
        await ctx.runMutation(internal.moduleWebhook.processModuleDeleteFailed, {
          instanceId: instance._id,
          correlationKey: event.moduleKey,
          moduleName: event.moduleName,
          moduleVersion: undefined,
          error: event.error || undefined,
          conflicts: event.inUseResources,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_TRIGGER_REGISTERED: {
        await ctx.runMutation(internal.moduleWebhook.processRegisteredDefinitions, {
          instanceId: instance._id,
          moduleName: event.moduleName,
          moduleVersion: event.version,
          triggers: event.triggers,
          actions: [],
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_ACTION_REGISTERED: {
        await ctx.runMutation(internal.moduleWebhook.processRegisteredDefinitions, {
          instanceId: instance._id,
          moduleName: event.moduleName,
          moduleVersion: event.version,
          triggers: [],
          actions: event.actions,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_WIDGET_REGISTERED: {
        // Upsert the widget definition AND place it for this instance
        // (instanceWidgets join). Built-ins (createdByType "SYSTEM") have no
        // module — registerFromWebhook resolves moduleId only for MODULE widgets.
        // Key on the canonical projectionKey, NOT widget.id (the engine omits id
        // for built-ins, which previously produced a duplicate empty-id row).
        for (const widget of event.widgets) {
          // The engine sends ConfigField[] — the same shape a trigger's or
          // action's fields use — so there is nothing left to translate.
          const settings = widget.settings;
          const widgetId = widgetCanonicalKey({
            projectionKey: widget.projectionKey,
            createdByRef: widget.createdByRef,
            manifestId: widget.manifestId,
            canonicalId: widget.canonicalId,
            id: widget.id,
          });
          await ctx.runMutation(internal.moduleWidgets.registerFromWebhook, {
            instanceId: instance._id,
            widgetId,
            name: widget.name ?? widgetId,
            directory: widget.directory ?? "",
            description: widget.description,
            createdByType: widget.createdByType,
            createdByRef: widget.createdByRef,
            projectionKey: widget.projectionKey,
            alertTypes: widget.alertTypes ?? [],
            settings,
            surfaces: widget.surfaces,
            hostsSurface: widget.hostsSurface,
          });
        }
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_WIDGET_DEREGISTERED: {
        for (const widget of event.widgets) {
          await ctx.runMutation(internal.moduleWidgets.unregister, {
            instanceId: instance._id,
            widgetId: widgetCanonicalKey({
              projectionKey: widget.projectionKey,
              createdByRef: widget.createdByRef,
              manifestId: widget.manifestId,
              canonicalId: widget.canonicalId,
              id: widget.id,
            }),
          });
        }
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.WORKFLOW_CREATED:
      case EngineEventType.WORKFLOW_UPDATED: {
        await ctx.runMutation(internal.workflowInternal.upsertFromWebhook, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          engineWorkflowId: event.workflow.id,
          definition: event.workflow.definition,
          isEnabled: event.workflow.isEnabled,
        });
        if (event.correlationKey) {
          await ctx.runMutation(internal.workflowInternal.resolveCorrelation, {
            correlationKey: event.correlationKey,
            engineWorkflowId: event.workflow.id,
            op: event.type === EngineEventType.WORKFLOW_CREATED ? "create" : "update",
          });
        }
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.WORKFLOW_DELETED: {
        await ctx.runMutation(internal.workflowInternal.deleteFromWebhook, {
          instanceId: instance._id,
          engineWorkflowId: event.workflowId,
        });
        if (event.correlationKey) {
          await ctx.runMutation(internal.workflowInternal.resolveCorrelationForDelete, {
            correlationKey: event.correlationKey,
            engineWorkflowId: event.workflowId,
          });
        }
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.SCENE_CREATED: {
        await ctx.runMutation(internal.scenes.upsertFromWebhook, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          engineSceneId: event.scene.id,
          name: event.scene.name,
          description: event.scene.description,
          widgetsJson: event.scene.widgetsJson,
          layoutJson: event.scene.layoutJson,
          createdByType: event.scene.createdByType,
          createdByRef: event.scene.createdByRef,
          createdAt: event.scene.createdAt,
          updatedAt: event.scene.updatedAt,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.SCENE_UPDATED: {
        await ctx.runMutation(internal.scenes.upsertFromWebhook, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          engineSceneId: event.scene.id,
          name: event.scene.name,
          description: event.scene.description,
          widgetsJson: event.scene.widgetsJson,
          layoutJson: event.scene.layoutJson,
          createdByType: event.scene.createdByType,
          createdByRef: event.scene.createdByRef,
          createdAt: event.scene.createdAt,
          updatedAt: event.scene.updatedAt,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.SCENE_DELETED: {
        await ctx.runMutation(internal.scenes.deleteFromWebhook, {
          instanceId: instance._id,
          engineSceneId: event.sceneId,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.COMMAND_CREATED:
      case EngineEventType.COMMAND_UPDATED: {
        await ctx.runMutation(internal.chatCommands.upsertFromWebhook, {
          instanceId: instance._id,
          applicationId: event.command.applicationId,
          engineCommandId: event.command.id,
          command: event.command.command,
          // Already `$`-escaped: the whole webhook payload is escaped on the
          // way in (see the escapeDollarKeys call on the envelope above).
          actions: event.command.actions ?? [],
          cooldown: event.command.cooldown,
          priority: event.command.priority,
          enabled: event.command.enabled,
          visibility: event.command.visibility,
          groupIds: event.command.groupIds ?? [],
          usernames: event.command.usernames ?? [],
          argumentPattern: event.command.argumentPattern ?? "",
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.COMMAND_DELETED: {
        await ctx.runMutation(internal.chatCommands.deleteFromWebhook, {
          instanceId: instance._id,
          engineCommandId: event.commandId,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.GROUP_CREATED:
      case EngineEventType.GROUP_UPDATED: {
        await ctx.runMutation(internal.chatCommandGroups.upsertFromWebhook, {
          instanceId: instance._id,
          applicationId: event.group.applicationId,
          engineGroupId: event.group.id,
          name: event.group.name,
          description: event.group.description,
          isBuiltIn: event.group.isBuiltIn,
          engineCreatedAt: event.group.createdAt,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.GROUP_DELETED: {
        await ctx.runMutation(internal.chatCommandGroups.deleteFromWebhook, {
          instanceId: instance._id,
          engineGroupId: event.groupId,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.GROUP_MEMBER_ADDED: {
        await ctx.runMutation(internal.chatCommandGroups.addMemberFromWebhook, {
          instanceId: instance._id,
          engineGroupId: event.groupId,
          username: event.username,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.GROUP_MEMBER_REMOVED: {
        await ctx.runMutation(internal.chatCommandGroups.removeMemberFromWebhook, {
          instanceId: instance._id,
          engineGroupId: event.groupId,
          username: event.username,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_TRIGGER_DEREGISTERED: {
        await ctx.runMutation(internal.moduleWebhook.processDeregisteredDefinitions, {
          instanceId: instance._id,
          triggers: event.triggers,
          actions: [],
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_ACTION_DEREGISTERED: {
        await ctx.runMutation(internal.moduleWebhook.processDeregisteredDefinitions, {
          instanceId: instance._id,
          triggers: [],
          actions: event.actions,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_FUNCTION_REGISTERED: {
        await ctx.runMutation(internal.moduleFunctions.upsertFromWebhook, {
          instanceId: instance._id,
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          functions: event.functions,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_FUNCTION_DEREGISTERED: {
        await ctx.runMutation(internal.moduleFunctions.deleteFromWebhook, {
          instanceId: instance._id,
          functions: event.functions,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_ASSET_REGISTERED: {
        await ctx.runMutation(internal.moduleAssets.upsertFromWebhook, {
          instanceId: instance._id,
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assets: event.assets,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_ASSET_DEREGISTERED: {
        await ctx.runMutation(internal.moduleAssets.deleteFromWebhook, {
          instanceId: instance._id,
          moduleKey: event.moduleKey,
          moduleName: event.moduleName,
          version: event.version,
          assets: event.assets,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_RESOURCE_INSTANCE_UPDATED:
      case EngineEventType.MODULE_RESOURCE_INSTANCE_CREATED: {
        await ctx.runMutation(internal.moduleResourceInstances.upsertFromWebhook, {
          instanceId: instance._id,
          instance: event.instance,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_RESOURCE_INSTANCE_DELETED: {
        await ctx.runMutation(internal.moduleResourceInstances.deleteFromWebhook, {
          instanceId: instance._id,
          instance: event.instance,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.MODULE_STORAGE_CHANGED: {
        const canonicalId = canonicalIdForStorageKey(event.key);
        if (canonicalId) {
          await ctx.runMutation(internal.resourceValues.upsert, {
            instanceId: instance._id,
            canonicalId,
            value: event.value ?? null,
          });
        }
        await ctx.runMutation(internal.transientEvents.emit, {
          instanceId: instance._id,
          correlationKey: `${event.moduleId}:${event.key}`,
          type: "module.storage.changed",
          status: "success",
          data: {
            moduleId: event.moduleId,
            key: event.key,
            value: event.value,
            previousValue: event.previousValue,
            occurredAt: event.occurredAt,
          },
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.ENGINE_RESPONSE_RECEIVED: {
        await ctx.runMutation(internal.transientEvents.emit, {
          instanceId: instance._id,
          correlationKey: event.correlationKey,
          type: "engine.response",
          status: event.status,
          message: event.error,
          data: event.data,
        });
        return corsJson({ success: true, type: event.type });
      }

      // A workflow run somebody is waiting on. transientEvents is keyed by the
      // client-generated id the trigger carried, so the UI subscribes before
      // the run exists; these three arms are the only thing that turns "the
      // event was published" into an outcome it can actually show.
      case EngineEventType.WORKFLOW_RUN_STARTED:
      case EngineEventType.WORKFLOW_RUN_COMPLETED:
      case EngineEventType.WORKFLOW_RUN_FAILED: {
        if (!event.triggerId) {
          // The api-side relay already drops these, so arriving here means an
          // older engine or a hand-published event. There is nothing to
          // correlate it to, and writing a row under an undefined key would
          // put it somewhere no subscriber looks.
          return corsJson({ success: true, type: event.type, handled: false });
        }
        await ctx.runMutation(internal.transientEvents.emit, {
          instanceId: instance._id,
          correlationKey: event.triggerId,
          type: event.type,
          status:
            event.type === EngineEventType.WORKFLOW_RUN_FAILED
              ? "error"
              : event.type === EngineEventType.WORKFLOW_RUN_COMPLETED
                ? "success"
                : "progress",
          message: event.type === EngineEventType.WORKFLOW_RUN_FAILED ? event.error : undefined,
          data: {
            workflowId: event.workflowId,
            executionId: event.executionId,
            triggeredBy: event.triggeredBy,
            occurredAt: event.occurredAt,
          },
        });
        return corsJson({ success: true, type: event.type });
      }

      // Durable run history. Separate from the WORKFLOW_RUN_STARTED family
      // above, which writes transientEvents for a caller watching one run:
      // these are database rows, and they outlive the person who wasn't there.
      case EngineEventType.WORKFLOW_RUN_RECORDED: {
        await ctx.runMutation(internal.workflowRuns.recordFromWebhook, {
          instanceId: instance._id,
          run: event.run,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.WORKFLOW_RUN_UPDATED: {
        await ctx.runMutation(internal.workflowRuns.updateFromWebhook, {
          instanceId: instance._id,
          run: event.run,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.WORKFLOW_RUN_STEP_RECORDED: {
        await ctx.runMutation(internal.workflowRuns.recordStepFromWebhook, {
          instanceId: instance._id,
          step: event.step,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.ALERT_RECORDED: {
        await ctx.runMutation(internal.engineAlerts.recordFromWebhook, {
          instanceId: instance._id,
          snapshot: event.alert,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.ALERT_REPLAYED:
      case EngineEventType.ALERT_COMPLETED:
      case EngineEventType.ALERT_FAILED:
      case EngineEventType.ALERT_TIMED_OUT:
      case EngineEventType.ALERT_SKIPPED: {
        await ctx.runMutation(internal.engineAlerts.updateFromWebhook, {
          instanceId: instance._id,
          snapshot: event.alert,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.WIDGET_STATUS_CHANGED: {
        const correlationKey = event.widgetCanonicalId ?? `${event.moduleId}:${event.instanceId}:${event.key}`;
        await ctx.runMutation(internal.transientEvents.emit, {
          instanceId: instance._id,
          correlationKey,
          type: "widget.status.changed",
          status: "success",
          data: {
            moduleId: event.moduleId,
            widgetInstanceId: event.instanceId,
            widgetCanonicalId: event.widgetCanonicalId,
            key: event.key,
            value: event.value,
            occurredAt: event.occurredAt,
          },
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.OVERLAY_TOKEN_REVOKED: {
        // Best-effort cache invalidation — see clearOverlayUrlByTokenId's doc
        // comment. woofx3-ui's own revoke/rotate calls (convex/browserSource.ts)
        // already keep their own cache correct; this only matters when a
        // token is revoked through some other channel.
        await ctx.runMutation(internal.browserSource.clearOverlayUrlByTokenId, {
          engineTokenId: event.tokenId,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.STREAM_ONLINE: {
        await ctx.runMutation(internal.instanceLiveState.onStreamOnline, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          twitchUserId: event.twitchUserId,
          startedAt: event.startedAt,
          streamTitle: event.streamTitle,
          gameName: event.gameName,
          viewerCount: event.viewerCount,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.STREAM_OFFLINE: {
        await ctx.runMutation(internal.instanceLiveState.onStreamOffline, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          twitchUserId: event.twitchUserId,
        });
        return corsJson({ success: true, type: event.type });
      }

      case EngineEventType.SESSION_STARTED: {
        await ctx.runMutation(internal.instanceLiveState.onSessionStarted, {
          instanceId: instance._id,
          applicationId: event.applicationId,
          sessionId: event.sessionId,
          sessionStartedAt: event.startedAt,
        });
        return corsJson({ success: true, type: event.type });
      }

      default: {
        logger.warn("webhook: unhandled event type", { eventType });
        return corsJson({ success: true, type: eventType, handled: false });
      }
    }
  }),
});

/**
 * Progress callbacks from the woofx3 maintenance API while it provisions or
 * tears down a managed engine.
 *
 * Unlike the engine's own webhook above, this caller is one trusted service
 * rather than one engine per tenant, so it authenticates with an HMAC over the
 * exact body instead of a per-instance bearer token: there is no instance to
 * look a token up by until provisioning finishes. The engine a callback is
 * about is found by `engineId`, which this deployment recorded when it asked
 * for the engine.
 *
 * Delivery is at-least-once and the sender retries until it sees a 2xx, so a
 * repeat must be acknowledged rather than applied twice, and a rejected
 * signature must answer 401 rather than 200.
 */
http.route({
  path: "/api/webhooks/maintenance",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.MAINTENANCE_WEBHOOK_SECRET;
    if (!secret) {
      logger.error("maintenance webhook: MAINTENANCE_WEBHOOK_SECRET is not configured");
      return new Response(JSON.stringify({ error: "Not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // The signature covers the exact bytes sent, so the body is read as text
    // and parsed only after it verifies.
    const body = await request.text();
    const verification = await verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret, new Date());
    if (!verification.valid) {
      logger.warn("maintenance webhook: rejected", { reason: verification.reason });
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return corsJson({ error: "Invalid JSON" }, 400);
    }
    const event = payload as Record<string, unknown>;
    const eventId = typeof event.id === "string" ? event.id : null;
    const eventType = typeof event.type === "string" ? event.type : null;
    if (!eventId || !eventType) {
      return corsJson({ error: "Missing id or type" }, 400);
    }
    const engineId = typeof event.engineId === "string" ? event.engineId : null;
    if (!engineId) {
      logger.warn("maintenance webhook: event without an engineId", { type: eventType, eventId });
      return corsJson({ success: true, type: eventType, handled: false });
    }

    logger.info("maintenance webhook: event received", { type: eventType, engineId, eventId });

    // Deduping and applying are one transaction, so a redelivery of an event
    // whose effect did not commit is applied rather than swallowed.
    const result = await ctx.runMutation(internal.provisioningInternal.applyCallbackEvent, {
      eventId,
      eventType,
      maintenanceEngineId: engineId,
      step: typeof event.step === "string" ? event.step : undefined,
      label: typeof event.label === "string" ? event.label : undefined,
      stepStatus: maintenanceStepStatus(event.status) ?? undefined,
      url: typeof event.url === "string" ? event.url : undefined,
      version: typeof event.version === "string" ? event.version : undefined,
      runKind: maintenanceRunKind(event.runKind) ?? undefined,
      error: maintenanceErrorText(event.error),
    });
    return corsJson({ success: true, type: eventType, ...result });
  }),
});

/** Which kind of run an event came from; a failure means opposite things for a build and a teardown. */
function maintenanceRunKind(value: unknown): "provision" | "deprovision" | "redeploy" | null {
  switch (value) {
    case "provision":
    case "deprovision":
    case "redeploy":
      return value;
    default:
      return null;
  }
}

/** The maintenance API's step statuses; anything else means the contract moved and the event is refused. */
function maintenanceStepStatus(value: unknown): "pending" | "running" | "succeeded" | "failed" | "skipped" | null {
  switch (value) {
    case "pending":
    case "running":
    case "succeeded":
    case "failed":
    case "skipped":
      return value;
    default:
      return null;
  }
}

/** `{ code, message }` flattened for display; the code is kept because it is stable and the message is not. */
function maintenanceErrorText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const error = value as { code?: unknown; message?: unknown };
  if (typeof error.message !== "string") {
    return undefined;
  }
  return typeof error.code === "string" ? `${error.code}: ${error.message}` : error.message;
}

http.route({ pathPrefix: "/api/browser-source/", method: "OPTIONS", handler: preflightHandler });
http.route({
  pathPrefix: "/api/browser-source/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/claim")) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const key = segments[segments.length - 2];

    if (!key) {
      return corsJson({ error: "Missing source key" }, 400);
    }

    const sourceKey = await ctx.runQuery(internal.browserSource.getSourceKeyByKey, { key });

    if (!sourceKey) {
      const debugInfo = await ctx.runQuery(internal.browserSource.getAllBrowserSourceKeys, {});
      return corsJson(
        {
          error: "Invalid source key",
          debug: { requestedKey: key.substring(0, 8) + "...", ...debugInfo },
        },
        401
      );
    }

    await ctx.runMutation(internal.browserSource.updateSourceKeyLastUsed, {
      keyId: sourceKey._id,
      lastUsedAt: Date.now(),
    });

    const scene = await ctx.runQuery(internal.browserSource.getScene, { sceneId: sourceKey.sceneId });
    const slots = await ctx.runQuery(internal.browserSource.getSceneSlots, { sceneId: sourceKey.sceneId });
    const alertDescriptors = await ctx.runQuery(internal.browserSource.getAlertDescriptorsForScene, {
      sceneId: sourceKey.sceneId,
    });

    return corsJson({ scene, slots, alertDescriptors, sourceKeyId: sourceKey._id });
  }),
});

http.route({ pathPrefix: "/api/browser-source/alerts/", method: "OPTIONS", handler: preflightHandler });
http.route({
  pathPrefix: "/api/browser-source/alerts/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const alertId = url.pathname.split("/").pop();
    const body = await request.json();

    if (!alertId) {
      return corsJson({ error: "Missing alertId" }, 400);
    }

    const newState = body.state as "rendering" | "complete" | "cancelled" | "expired" | undefined;

    if (!newState) {
      return corsJson({ error: "Missing state in request body" }, 400);
    }

    const validStates = ["rendering", "complete", "cancelled", "expired"];
    if (!validStates.includes(newState)) {
      return corsJson({ error: "Invalid state" }, 400);
    }

    await ctx.runMutation(internal.browserSource.updateAlertState, {
      alertId: alertId as string,
      state: newState,
      completedAt: newState === "complete" ? Date.now() : undefined,
    });

    if (newState === "complete" || newState === "cancelled" || newState === "expired") {
      const alert = await ctx.runQuery(internal.browserSource.getAlert, { alertId: alertId as string });
      if (alert && "_id" in alert && "instanceId" in alert && "sceneId" in alert) {
        const typedAlert = alert as {
          instanceId: string;
          sceneId: string;
          alertType: string;
          user: string;
          amount?: number;
          message?: string;
          tier?: string;
          createdAt: number;
        };
        await ctx.runMutation(internal.browserSource.createAlertHistory, {
          instanceId: typedAlert.instanceId as any,
          sceneId: typedAlert.sceneId as any,
          alertType: typedAlert.alertType,
          user: typedAlert.user,
          amount: typedAlert.amount,
          message: typedAlert.message,
          tier: typedAlert.tier,
          state: newState,
          createdAt: typedAlert.createdAt,
        });
      }
    }

    return corsJson({ success: true });
  }),
});

http.route({ path: "/api/obs/commands", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/obs/commands",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const sceneId = url.searchParams.get("sceneId");

    if (!sceneId) {
      return corsJson({ error: "Missing sceneId" }, 400);
    }

    const commands = await ctx.runQuery(internal.obsCommands.getPendingCommands, {
      sceneId: sceneId as string,
    });

    return corsJson({ commands });
  }),
});

http.route({ pathPrefix: "/api/obs/commands/", method: "OPTIONS", handler: preflightHandler });
http.route({
  pathPrefix: "/api/obs/commands/",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const commandId = url.pathname.split("/").pop();
    const body = await request.json();

    if (!commandId) {
      return corsJson({ error: "Missing commandId" }, 400);
    }

    const newState = body.state as "executing" | "complete" | "cancelled" | "expired" | undefined;

    if (!newState) {
      return corsJson({ error: "Missing state in request body" }, 400);
    }

    await ctx.runMutation(internal.obsCommands.updateCommandState, {
      commandId: commandId as string,
      state: newState,
    });

    return corsJson({ success: true });
  }),
});

http.route({ pathPrefix: "/api/widgets/", method: "OPTIONS", handler: preflightHandler });
http.route({
  pathPrefix: "/api/widgets/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length < 5) {
      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    }

    const moduleId = pathParts[2];
    const directory = pathParts[3];
    const file = pathParts.slice(4).join("/");

    // TODO: Integrate with barkloader's storage system to fetch actual widget assets
    // This placeholder response should be replaced with actual asset fetching logic
    const contentTypes: Record<string, string> = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
      png: "image/png",
      jpg: "image/jpeg",
      svg: "image/svg+xml",
    };

    const ext = file.split(".").pop() || "";
    const contentType = contentTypes[ext] || "text/plain";

    return new Response(`Widget file: ${file} for module ${moduleId}/${directory}`, {
      headers: { "Content-Type": contentType, ...CORS_HEADERS },
    });
  }),
});

http.route({
  pathPrefix: "/browser-source/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    const key = segments[1];

    if (!key) {
      return new Response("Missing source key", { status: 400 });
    }

    const sourceKey = await ctx.runQuery(internal.browserSource.getSourceKeyByKey, { key });
    if (!sourceKey) {
      return new Response("Invalid source key", { status: 404 });
    }

    await ctx.runMutation(internal.browserSource.updateSourceKeyLastUsed, {
      keyId: sourceKey._id,
      lastUsedAt: Date.now(),
    });

    const scene = await ctx.runQuery(internal.browserSource.getScene, { sceneId: sourceKey.sceneId });
    if (!scene) {
      return new Response("Scene not found", { status: 404 });
    }

    const sceneName = scene.name ?? "Scene";
    const htmlResponse = (body: string) =>
      new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

    // Scenes are engine-authoritative and the engine renders the overlay, so this
    // route just redirects to the engine-minted overlay-token URL cached on the
    // source key (see convex/browserSource.ts's getOrCreateBrowserSourceKey — it
    // mints via the engine's overlayTokenRoutes at key-creation time, not here, so
    // this stays a single fast lookup on every OBS page load). Why a redirect
    // rather than a wrapper page: see buildBrowserSourceRedirect.
    if (!scene.engineSceneId) {
      return htmlResponse(
        buildBrowserSourcePlaceholderHtml({
          sceneName,
          reason: "This scene has not finished syncing with the engine yet.",
        })
      );
    }

    // A URL from before Scene Manager replaced streamware's overlay path resolves to nothing;
    // say so rather than redirecting to a dead page. Reopening the scene editor re-mints it.
    if (!isCurrentSceneUrl(sourceKey.overlayUrl, scene.engineSceneId)) {
      return htmlResponse(
        buildBrowserSourcePlaceholderHtml({
          sceneName,
          reason: "This browser source hasn't finished setting up yet — reopen it from the scene editor.",
        })
      );
    }

    return buildBrowserSourceRedirect(sourceKey.overlayUrl);
  }),
});

/** How long the control plane waits for the engine to run a webhook handler. */
const INBOUND_WEBHOOK_ENGINE_TIMEOUT_MS = 10_000;

// Third-party webhooks: a POST, or a GET verification handshake, to
// /api/webhooks/<endpointId>. The exact /api/webhooks/woofx3 routes above
// still win: the router matches exact paths before prefixes.
const inboundWebhookHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const path = parseInboundWebhookPath(url.pathname);
  if (!path.ok) {
    return new Response(null, { status: 404 });
  }
  const endpoint = await ctx.runQuery(internal.inboundWebhooks.getByEndpointId, { endpointId: path.endpointId });
  if (!endpoint || !endpoint.isEnabled) {
    return new Response(null, { status: 404 });
  }

  if (Number(request.headers.get("content-length") ?? "0") > MAX_INBOUND_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_INBOUND_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  // Bookkeeping must never change the answer a provider gets.
  const recordDelivery = async (status: number, error?: string) => {
    try {
      await ctx.runMutation(internal.inboundWebhooks.recordDelivery, { endpointId: endpoint._id, status, error });
    } catch (err) {
      logger.warn("inbound webhook: failed to record delivery", {
        endpointId: endpoint.endpointId,
        error: String(err),
      });
    }
  };

  const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId: endpoint.instanceId });
  if (!instance?.url || !instance.clientId || !instance.clientSecret) {
    await recordDelivery(503, "instance is not registered with an engine");
    return new Response(null, { status: 503 });
  }

  const forwarded = buildForwardedRequest(request, url, body, crypto.randomUUID());
  let engineResponse: InboundWebhookResponse;
  try {
    const rpc = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
    engineResponse = await withEngineTimeout(
      rpc.handleInboundWebhook(endpoint.triggerKey, forwarded),
      INBOUND_WEBHOOK_ENGINE_TIMEOUT_MS
    );
  } catch (err) {
    const timedOut = err instanceof EngineTimeoutError;
    const status = timedOut ? 504 : 503;
    await recordDelivery(status, timedOut ? "engine did not answer in time" : "engine unreachable");
    return new Response(null, { status });
  }

  const response = toHttpResponse(engineResponse);
  await recordDelivery(
    response.status,
    response.status >= 500 ? `engine answered ${engineResponse.status}` : undefined
  );
  return response;
});

http.route({ pathPrefix: "/api/webhooks/", method: "POST", handler: inboundWebhookHandler });
http.route({ pathPrefix: "/api/webhooks/", method: "GET", handler: inboundWebhookHandler });

export default http;
