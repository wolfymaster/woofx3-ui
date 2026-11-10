import { valuesToPairs } from "@shared/macro-run";
import { integrationOfModuleOAuthState } from "@shared/module-oauth";
import type { InboundWebhookResponse } from "@woofx3/api";
import type { CallbackEnvelope } from "@woofx3/api/webhooks";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { type ActionCtx, httpAction } from "./_generated/server";
import { auth } from "./auth";
import type { WebhookEventResult } from "./engineEvents";
import { registerEngineEventRoutes } from "./engineEventsHttp";
import { buildBrowserSourcePlaceholderHtml, buildBrowserSourceRedirect } from "./lib/browserSourceHtml";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { RELAY_CREDENTIAL_REQUESTED_EVENT_TYPE } from "./lib/engineRelay";
import { engineActivityPatch } from "./lib/engineSync/activity";
import { admitInboundWebhook, inboundWebhookRateLimiter } from "./lib/inboundWebhookLimits";
import { parseInboundWebhookPath } from "./lib/inboundWebhookPath";
import {
  buildForwardedRequest,
  EngineTimeoutError,
  MAX_INBOUND_BODY_BYTES,
  toHttpResponse,
  withEngineTimeout,
} from "./lib/inboundWebhookRelay";
import { executeMacroPlan, MacroRunRefused } from "./lib/macroExecution";
import {
  hashTriggerToken,
  isBrowserRequest,
  MACRO_TRIGGER_PATH,
  MACRO_TRIGGER_PATH_PREFIX,
  MAX_TRIGGER_BODY_BYTES,
  parseTriggerValues,
  resolveTriggerToken,
  triggerRefusalResponse,
} from "./lib/macroTrigger";
import { SIGNATURE_HEADER, verifySignature } from "./lib/maintenanceSignature";
import { OAUTH_CALLBACK_PATHS, oauthCallbackUrl } from "./lib/oauthCallback";
import type { OAuthErrorCode } from "./lib/oauthErrors";
import { generateOpaqueToken, hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { forwardedCallbackUrl, mintOAuthState, oauthStateConfigFromEnv, routeOAuthState } from "./lib/oauthState";
import { OPS_PATH_PREFIX } from "./lib/ops/routes";
import { platformTokenCipher, sealPlatformLinkTokens } from "./lib/platformLinkTokens";
import { withQuery } from "./lib/safeRedirect";
import { isCurrentSceneUrl } from "./lib/sceneOverlayUrl";
import { parseEngineShoutoutTarget, SHOUTOUT_ENQUEUE_REQUESTED_EVENT_TYPE } from "./lib/shoutoutEngineRequest";
import { canManageTwitchLink } from "./lib/twitchLinkPolicy";
import { DESKTOP_SIGN_IN_PAGE_PATH, isNonceHash, parseSignInClient } from "./lib/twitchSignIn";
import { TWITCH_TOKEN_REQUESTED_EVENT_TYPE } from "./lib/twitchTokenGrant";
import { logger } from "./logger";
import { opsHandler } from "./ops/http";
import { registerUserPageFormRoutes } from "./userPageFormsHttp";
import { registerViewerAuthRoutes } from "./viewerAuthHttp";
import "./browserSource";
import "./moduleWebhook";
import { OUTBOUND_FETCH_TIMEOUT_MS } from "./lib/outboundTimeouts";

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

type LogDetail = Record<string, string | number | boolean | string[]>;

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

/**
 * Back to the callback page with an error code to show. Only the code travels
 * in the URL; the page maps it to fixed text (lib/oauthErrors.ts), and any
 * detail goes to the log without provider response bodies or tokens.
 */
function signInErrorRedirect(siteUrl: string, code: OAuthErrorCode, detail: LogDetail = {}): Response {
  logger.error("twitch sign-in failed", { code, ...detail });
  return redirect(`${siteUrl}/auth/twitch/callback?${new URLSearchParams({ error: code })}`);
}

/**
 * The desktop flavour of `signInErrorRedirect`: the browser lands on a page
 * that says to return to the app, and, when the sign-in's nonce hash is
 * known, the app is told how it ended so it stops waiting.
 */
async function desktopSignInErrorRedirect(
  ctx: ActionCtx,
  siteUrl: string,
  nonceHash: string | null,
  code: OAuthErrorCode,
  detail: LogDetail = {}
): Promise<Response> {
  logger.error("twitch desktop sign-in failed", { code, ...detail });
  if (nonceHash !== null) {
    await ctx.runMutation(internal.twitchAuth.storeDesktopSignInFailure, { nonceHash, error: code });
  }
  return redirect(`${siteUrl}${DESKTOP_SIGN_IN_PAGE_PATH}?${new URLSearchParams({ error: code })}`);
}

/**
 * The connect flavour of `signInErrorRedirect`: the creator is signed in
 * already, so the page offers a way back to where they started rather than
 * the login page.
 */
function connectErrorRedirect(siteUrl: string, redirectTo: string, code: OAuthErrorCode, detail: LogDetail = {}) {
  logger.error("twitch connect failed", { code, ...detail });
  const params = new URLSearchParams({ mode: "connect", error: code, redirect_to: redirectTo });
  return redirect(`${siteUrl}/auth/twitch/callback?${params}`);
}

/** Field names only: a token response body carries the tokens themselves. */
function fieldNames(body: unknown): string[] {
  if (typeof body !== "object" || body === null) {
    return [];
  }
  return Object.keys(body);
}

http.route({
  path: "/api/auth/twitch/start",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.SITE_URL, "SITE_URL env var is not set");
    assert(process.env.AUTH_TWITCH_ID, "AUTH_TWITCH_ID env var is not set");

    const url = new URL(request.url);
    const redirectTo = url.searchParams.get("redirect_to") ?? "/";
    const signInClient = parseSignInClient(url.searchParams.get("client"));
    if (signInClient === null) {
      return signInErrorRedirect(process.env.SITE_URL, "sign_in_not_started_here");
    }
    let nonceHash: string;
    if (signInClient === "desktop") {
      // The desktop app keeps the nonce and sends only its hash
      // (lib/twitchSignIn.ts): this URL is shown, and kept in history, by the
      // system browser.
      const presented = url.searchParams.get("nonce_hash");
      if (!isNonceHash(presented)) {
        return desktopSignInErrorRedirect(ctx, process.env.SITE_URL, null, "sign_in_not_started_here");
      }
      nonceHash = presented;
    } else {
      // Generated by the SPA tab that is signing in and kept there
      // (client/src/lib/twitch-sign-in.ts); the sign-in completes only when that
      // tab presents it again.
      const nonce = url.searchParams.get("nonce");
      if (!isOpaqueToken(nonce)) {
        return signInErrorRedirect(process.env.SITE_URL, "sign_in_not_started_here");
      }
      nonceHash = await hashOpaqueToken(nonce);
    }
    const state = await mintOAuthState(oauthStateConfigFromEnv());

    const stored = await ctx.runMutation(internal.twitchAuth.storeState, {
      state,
      redirectTo,
      nonceHash,
      signInClient,
    });
    if (stored === "nonce_in_use") {
      return desktopSignInErrorRedirect(ctx, process.env.SITE_URL, null, "sign_in_not_started_here");
    }

    const params = new URLSearchParams({
      client_id: process.env.AUTH_TWITCH_ID,
      redirect_uri: oauthCallbackUrl("twitch"),
      response_type: "code",
      scope: "user:read:email",
      state,
    });

    logger.info("redirecting to twitch for sign-in");
    return redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
  }),
});

http.route({
  path: OAUTH_CALLBACK_PATHS.twitch,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    assert(process.env.SITE_URL, "SITE_URL env var is not set");
    assert(process.env.AUTH_TWITCH_ID, "AUTH_TWITCH_ID env var is not set");
    assert(process.env.AUTH_TWITCH_SECRET, "AUTH_TWITCH_SECRET env var is not set");

    const siteUrl = process.env.SITE_URL;
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    logger.info("callback received", { hasCode: !!code, hasState: !!state });

    if (!state) {
      return signInErrorRedirect(siteUrl, "missing_params", { hasCode: !!code });
    }
    const route = await routeOAuthState(state, oauthStateConfigFromEnv());
    if (route.kind === "forward") {
      return redirect(forwardedCallbackUrl(route.origin, url));
    }
    if (route.kind === "invalid") {
      return signInErrorRedirect(siteUrl, "invalid_state");
    }
    const stateResult = await ctx.runMutation(internal.twitchAuth.validateAndConsumeState, { state });
    if (!stateResult) {
      return signInErrorRedirect(siteUrl, "invalid_state");
    }
    const { redirectTo, instanceId, userId, nonceHash, signInClient } = stateResult;
    const fail = async (errorCode: OAuthErrorCode, detail: LogDetail = {}): Promise<Response> => {
      if (instanceId) {
        return connectErrorRedirect(siteUrl, redirectTo, errorCode, detail);
      }
      if (signInClient === "desktop") {
        return desktopSignInErrorRedirect(ctx, siteUrl, nonceHash, errorCode, detail);
      }
      return signInErrorRedirect(siteUrl, errorCode, detail);
    };

    if (!code) {
      // Twitch answers a declined consent with ?error=access_denied and no code.
      return fail(url.searchParams.get("error") === "access_denied" ? "access_denied" : "missing_params");
    }

    // An integration state is minted only by twitchIntegration.startConnect,
    // for an owner or admin. Checked again here because a role can be taken
    // away in the minutes the creator spends on Twitch's consent page, and
    // once more when the connect is finished.
    if (instanceId) {
      if (!userId) {
        return fail("not_started_by_user");
      }
      const role = await ctx.runQuery(internal.instances.memberRole, { instanceId, userId });
      if (!canManageTwitchLink(role)) {
        return fail("not_permitted");
      }
    } else if (!nonceHash) {
      return fail("sign_in_not_started_here");
    }

    logger.info("state valid, exchanging code", { isIntegration: !!instanceId });

    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AUTH_TWITCH_ID,
        client_secret: process.env.AUTH_TWITCH_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: oauthCallbackUrl("twitch"),
      }),
    });

    if (!tokenRes.ok) {
      return fail("token_exchange_failed", { status: tokenRes.status });
    }

    const tokenData = await tokenRes.json();
    if (typeof tokenData?.access_token !== "string" || tokenData.access_token.length === 0) {
      return fail("token_exchange_failed", { fields: fieldNames(tokenData) });
    }
    logger.info("token exchange ok");

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Client-Id": process.env.AUTH_TWITCH_ID,
      },
    });

    if (!userRes.ok) {
      return fail("profile_fetch_failed", { status: userRes.status });
    }

    const { data } = await userRes.json();
    if (!Array.isArray(data) || data.length === 0) {
      return fail("profile_fetch_failed", { reason: "empty user data" });
    }
    const twitchUser = data[0];
    logger.info("got twitch user", { login: twitchUser.login, id: twitchUser.id });

    if (instanceId && userId) {
      if (typeof tokenData.refresh_token !== "string" || typeof tokenData.expires_in !== "number") {
        return fail("token_exchange_failed", { fields: fieldNames(tokenData) });
      }
      const scopes: string[] = Array.isArray(tokenData.scope)
        ? tokenData.scope
        : String(tokenData.scope ?? "").split(" ");

      // The result is held for the user who started the connect, not written
      // here: this request runs in whichever browser Twitch redirected, which
      // is not necessarily theirs.
      const sealed = await sealPlatformLinkTokens(await platformTokenCipher(), {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
      });
      const handoffCode = generateOpaqueToken();
      await ctx.runMutation(internal.oauthConnectHandoff.store, {
        codeHash: await hashOpaqueToken(handoffCode),
        provider: "twitch",
        userId,
        instanceId,
        redirectTo,
        twitch: {
          platformUserId: twitchUser.id,
          platformUsername: twitchUser.display_name || twitchUser.login,
          login: twitchUser.login,
          profileImageUrl: twitchUser.profile_image_url ?? undefined,
          ...sealed,
          expiresAt: Date.now() + tokenData.expires_in * 1000,
          scopes,
        },
      });

      logger.info("redirecting to frontend to finish the connect");
      const params = new URLSearchParams({ mode: "connect", code: handoffCode, redirect_to: redirectTo });
      return redirect(`${siteUrl}/auth/twitch/callback?${params}`);
    }

    assert(nonceHash && signInClient, "sign-in state without a nonce hash or client");
    const token = await ctx.runMutation(internal.twitchAuth.storePendingAuth, {
      twitchId: twitchUser.id,
      displayName: twitchUser.display_name,
      email: twitchUser.email ?? "",
      profileImage: twitchUser.profile_image_url ?? "",
      nonceHash,
      signInClient,
    });

    if (signInClient === "desktop") {
      // The token stays in Convex until the app claims it with the nonce.
      logger.info("redirecting the browser back to the desktop app");
      return redirect(`${siteUrl}${DESKTOP_SIGN_IN_PAGE_PATH}`);
    }

    logger.info("redirecting to frontend to finish sign-in");
    const params = new URLSearchParams({ token, redirect_to: redirectTo });
    return redirect(`${siteUrl}/auth/twitch/callback?${params}`);
  }),
});

function moduleIntegrationErrorRedirect(
  siteUrl: string,
  redirectTo: string,
  integration: string,
  code: OAuthErrorCode,
  detail: LogDetail = {}
): Response {
  logger.error("module integration oauth failed", { integration, code, ...detail });
  return redirect(`${siteUrl}${withQuery(redirectTo, { integration, status: "error", error: code }, "/modules")}`);
}

http.route({
  path: OAUTH_CALLBACK_PATHS.module,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const siteUrl = process.env.SITE_URL ?? "";
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    // Until the state is read, neither the integration nor the return path is known.
    if (!state) {
      return moduleIntegrationErrorRedirect(siteUrl, "/modules", "module", "missing_params");
    }
    const route = await routeOAuthState(state, oauthStateConfigFromEnv());
    if (route.kind === "forward") {
      return redirect(forwardedCallbackUrl(route.origin, url));
    }
    if (route.kind === "invalid") {
      return moduleIntegrationErrorRedirect(siteUrl, "/modules", "module", "invalid_state");
    }
    const stateResult = await ctx.runMutation(internal.moduleIntegrationState.validateAndConsumeState, { state });
    const integration = stateResult ? integrationOfModuleOAuthState(stateResult.integration) : null;
    if (!stateResult || !integration) {
      return moduleIntegrationErrorRedirect(siteUrl, "/modules", "module", "invalid_state");
    }
    const { instanceId, moduleId, redirectTo, userId, data } = stateResult;
    if (!code) {
      const declined = url.searchParams.get("error") === "access_denied";
      return moduleIntegrationErrorRedirect(
        siteUrl,
        redirectTo,
        integration,
        declined ? "access_denied" : "missing_params"
      );
    }
    // moduleOAuth.start mints states only for a member; checked again in case
    // the membership went away meanwhile, and once more when it is finished.
    if (!userId) {
      return moduleIntegrationErrorRedirect(siteUrl, redirectTo, integration, "not_started_by_user");
    }
    if ((await ctx.runQuery(internal.instances.memberRole, { instanceId, userId })) === null) {
      return moduleIntegrationErrorRedirect(siteUrl, redirectTo, integration, "not_permitted");
    }
    const { clientId, codeVerifier } = (data ?? {}) as { clientId?: string; codeVerifier?: string };
    if (!clientId || !codeVerifier) {
      return moduleIntegrationErrorRedirect(siteUrl, redirectTo, integration, "invalid_state", {
        reason: "malformed state data",
      });
    }
    // The browser the provider redirected may not be the one that started the
    // connect, so the authorization waits for that member to claim it
    // (moduleOAuth.finish) before the engine exchanges it.
    const handoffCode = generateOpaqueToken();
    await ctx.runMutation(internal.oauthConnectHandoff.store, {
      codeHash: await hashOpaqueToken(handoffCode),
      provider: "module",
      userId,
      instanceId,
      moduleId,
      redirectTo,
      moduleOAuth: { integration, code, codeVerifier, redirectUri: oauthCallbackUrl("module"), clientId },
    });
    return redirect(`${siteUrl}${withQuery(redirectTo, { integration, oauth_code: handoffCode }, "/modules")}`);
  }),
});

http.route({ path: "/api/webhooks/woofx3", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Checked before the body is read: a caller without the instance's secret gets a 401, not a parse or a log line.
    const authHeader = request.headers.get("Authorization");
    const providedSecret = authHeader?.replace("Bearer ", "");
    if (!providedSecret) {
      logger.warn("webhook: missing Authorization header");
      return corsJson({ error: "Missing Authorization header" }, 401);
    }
    const instance = await ctx.runQuery(internal.instances.getByWebhookSecret, { webhookSecret: providedSecret });
    if (!instance) {
      logger.warn("webhook: unauthorized - no instance found for provided secret");
      return corsJson({ error: "Unauthorized" }, 401);
    }

    const body = await request.text();
    let payload: { type?: string; data?: { type?: string } };
    try {
      payload = JSON.parse(body);
    } catch {
      return corsJson({ error: "Body must be JSON" }, 400);
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return corsJson({ error: "Body must be a JSON object" }, 400);
    }

    logger.info("webhook: incoming request", {
      type: payload.type,
      url: request.url,
    });

    if (!payload.type) {
      // Field names only: the body may carry anything the sender chose.
      logger.warn("webhook: missing type field", { fields: Object.keys(payload) });
      return corsJson({ error: "Missing required field: type" }, 400);
    }

    // An engine on the maintenance event queue sends its events there; one
    // that has not moved yet (too old to support an events target) posts them here.
    const eventType: string = payload.data?.type ?? payload.type;
    if (!ENGINE_REQUEST_TYPES.has(eventType)) {
      const result = await ctx.runMutation(internal.engineEvents.applyFromWebhook, { instanceId: instance._id, body });
      return legacyEventResponse(result, eventType);
    }
    return answerEngineRequest(ctx, instance, payload as CallbackEnvelope, eventType);
  }),
});

/**
 * The callbacks the engine waits on for an answer in the response body. Every
 * other type is an event, applied in one mutation.
 */
const ENGINE_REQUEST_TYPES: ReadonlySet<string> = new Set([
  RELAY_CREDENTIAL_REQUESTED_EVENT_TYPE,
  TWITCH_TOKEN_REQUESTED_EVENT_TYPE,
  SHOUTOUT_ENQUEUE_REQUESTED_EVENT_TYPE,
]);

/**
 * An event the engine cannot ever have applied answers 4xx, which it does not
 * retry; a failure while applying throws, answers 5xx, and is retried.
 */
function legacyEventResponse(result: WebhookEventResult, eventType: string): Response {
  switch (result.kind) {
    case "unauthorized":
      return corsJson({ error: "Unauthorized" }, 401);
    case "invalid":
      return corsJson({ error: result.reason }, 400);
    case "ignored":
      return corsJson({ success: true, type: eventType, handled: false });
    case "duplicate":
      return corsJson({ success: true, type: eventType, duplicate: true });
    case "applied":
      return corsJson({ success: true, type: eventType });
  }
}

async function answerEngineRequest(
  ctx: ActionCtx,
  instance: Doc<"instances">,
  envelope: CallbackEnvelope,
  eventType: string
): Promise<Response> {
  // A request shows the engine is running and may hold changes a scheduled
  // sync would mirror. Checked here first so most requests do not run a
  // mutation for it.
  if (engineActivityPatch(instance.lastEngineActivityAt, Date.now())) {
    try {
      await ctx.runMutation(internal.instances.recordEngineActivity, { instanceId: instance._id });
    } catch (error) {
      // Safe to carry on: a missed write only delays scheduled syncs until a
      // later callback records the activity, and the request must be answered.
      logger.warn("webhook: could not record engine activity", {
        instanceId: instance._id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The engine waits for a bridge credential, about every four minutes while
  // it bridges. Answered ahead of the event log, which records only a
  // failure: the body is a live credential, so no CORS headers, no caching,
  // and it is never logged.
  if (eventType === RELAY_CREDENTIAL_REQUESTED_EVENT_TYPE) {
    try {
      const answer = await ctx.runAction(internal.companionRelayActions.engineCredential, {
        instanceId: instance._id,
      });
      return new Response(JSON.stringify(answer), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("webhook: relay credential request failed", { instanceId: instance._id, error: message });
      await ctx.runMutation(internal.engineEventLog.record, {
        instanceId: instance._id,
        eventType,
        payload: JSON.stringify({ error: message }),
        envelopeId: typeof envelope.id === "string" ? envelope.id : undefined,
        engineEventTime: typeof envelope.time === "string" ? envelope.time : undefined,
      });
      return new Response(JSON.stringify({ error: "Could not issue a relay credential" }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
  }

  await ctx.runMutation(internal.engineEventLog.record, {
    instanceId: instance._id,
    eventType,
    payload: JSON.stringify(envelope.data ?? null),
    envelopeId: typeof envelope.id === "string" ? envelope.id : undefined,
    engineEventTime: typeof envelope.time === "string" ? envelope.time : undefined,
  });

  // The engine waits for the token in the response body. No CORS headers and
  // no caching: the body is a live access token, for the engine only.
  if (eventType === TWITCH_TOKEN_REQUESTED_EVENT_TYPE) {
    const answer = await ctx.runAction(internal.twitchIntegration.grantTokenToEngine, { instanceId: instance._id });
    return new Response(JSON.stringify(answer), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // The engine waits for the queue position, and only sends a shoutout itself
  // when it has no dashboard queue at all.
  const target = parseEngineShoutoutTarget(envelope.data);
  if (!target) {
    logger.warn("webhook: shoutout request without a target", { instanceId: instance._id });
    return corsJson({ error: "Shoutout request needs twitchUserId and login" }, 400);
  }
  const answer = await ctx.runMutation(internal.shoutouts.enqueueFromEngine, {
    instanceId: instance._id,
    ...target,
  });
  return corsJson(answer);
}

/**
 * Progress callbacks from the woofx3 maintenance API while it provisions,
 * upgrades or tears down a managed engine.
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
      externalRef: typeof event.externalRef === "string" ? event.externalRef : undefined,
      step: typeof event.step === "string" ? event.step : undefined,
      label: typeof event.label === "string" ? event.label : undefined,
      stepStatus: maintenanceStepStatus(event.status) ?? undefined,
      url: typeof event.url === "string" ? event.url : undefined,
      version: typeof event.version === "string" ? event.version : undefined,
      runKind: maintenanceRunKind(event.runKind) ?? undefined,
      error: maintenanceErrorText(event.error),
      runId: typeof event.runId === "string" ? event.runId : undefined,
      detail: maintenanceDetailText(event.detail),
      engineStatus: typeof event.engineStatus === "string" ? event.engineStatus : undefined,
      rollbackRunId: typeof event.rollbackRunId === "string" ? event.rollbackRunId : undefined,
      targetVersion: typeof event.targetVersion === "string" ? event.targetVersion : undefined,
      rollbackOf: typeof event.rollbackOf === "string" ? event.rollbackOf : undefined,
    });
    return corsJson({ success: true, type: eventType, ...result });
  }),
});

/** Which kind of run an event came from; a failure means opposite things for a build and a teardown. */
function maintenanceRunKind(value: unknown): "provision" | "deprovision" | "redeploy" | "stop" | "start" | null {
  switch (value) {
    case "provision":
    case "deprovision":
    case "redeploy":
    case "stop":
    case "start":
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

/** Why a step is waiting: only the message, since a reason is shown and never branched on. */
function maintenanceDetailText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const detail = value as { message?: unknown };
  return typeof detail.message === "string" ? detail.message : undefined;
}

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
  const admission = await admitInboundWebhook(() =>
    inboundWebhookRateLimiter.limit(ctx, "inboundWebhookDelivery", { key: endpoint._id })
  );
  if (!admission.ok) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } });
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

// The backoffice's ops API; see ops/http.ts.
http.route({ pathPrefix: OPS_PATH_PREFIX, method: "GET", handler: opsHandler });
http.route({ pathPrefix: OPS_PATH_PREFIX, method: "POST", handler: opsHandler });

http.route({ pathPrefix: "/api/webhooks/", method: "POST", handler: inboundWebhookHandler });
http.route({ pathPrefix: "/api/webhooks/", method: "GET", handler: inboundWebhookHandler });

/** How long a remote macro trigger waits for the engine to accept the run. */
const MACRO_TRIGGER_ENGINE_TIMEOUT_MS = 10_000;

/** Provenance for runs fired by a trigger URL. Unlike "dashboard", these are recorded in the run history. */
const MACRO_TRIGGER_PROVENANCE = "macro-trigger";

function macroTriggerJson(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

// A macro's remote trigger: POST /api/macros/trigger/<token>, or POST
// /api/macros/trigger with `Authorization: Bearer <token>`. GET only for a
// trigger that opted in. Requests from a web page are refused before the token
// is looked at, and a malformed token and an unknown one get the same 404.
const macroTriggerHandler = httpAction(async (ctx, request) => {
  const refuse = (refusal: Parameters<typeof triggerRefusalResponse>[0]) => {
    const response = triggerRefusalResponse(refusal);
    return macroTriggerJson(response.status, response.body, response.headers);
  };

  if (isBrowserRequest(request.headers.get("origin"))) {
    return refuse({ outcome: "browser-origin" });
  }
  const url = new URL(request.url);
  const token = resolveTriggerToken(url.pathname, request.headers.get("authorization"));
  if (!token) {
    return refuse({ outcome: "not-found" });
  }
  const method = request.method === "GET" ? "GET" : "POST";

  if (Number(request.headers.get("content-length") ?? "0") > MAX_TRIGGER_BODY_BYTES) {
    return macroTriggerJson(413, { ok: false, error: "body too large" });
  }
  const bodyBytes = method === "POST" ? await request.arrayBuffer() : new ArrayBuffer(0);
  if (bodyBytes.byteLength > MAX_TRIGGER_BODY_BYTES) {
    return macroTriggerJson(413, { ok: false, error: "body too large" });
  }
  const parsed = parseTriggerValues({
    contentType: request.headers.get("content-type"),
    body: new TextDecoder().decode(bodyBytes),
    query: url.searchParams,
  });
  if (!parsed.ok) {
    return macroTriggerJson(400, { ok: false, error: parsed.error });
  }

  const claim = await ctx.runMutation(internal.macroTriggers.claim, {
    tokenHash: await hashTriggerToken(token),
    method,
    values: valuesToPairs(parsed.values),
  });
  if (claim.outcome !== "run") {
    return refuse(claim);
  }

  // Bookkeeping must never change the answer the device gets.
  const recordOutcome = async (failure?: string) => {
    try {
      await ctx.runMutation(internal.macroTriggers.recordOutcome, { triggerId: claim.triggerId, failure });
    } catch (err) {
      logger.warn("macro trigger: failed to record outcome", { error: String(err) });
    }
  };

  try {
    const result = await withEngineTimeout(
      executeMacroPlan(claim.engine, claim.plan, MACRO_TRIGGER_PROVENANCE),
      MACRO_TRIGGER_ENGINE_TIMEOUT_MS
    );
    await recordOutcome();
    return macroTriggerJson(202, { ok: true, ...(result.triggerId ? { triggerId: result.triggerId } : {}) });
  } catch (err) {
    if (err instanceof MacroRunRefused) {
      await recordOutcome(err.message);
      return macroTriggerJson(409, { ok: false, error: err.message });
    }
    const timedOut = err instanceof EngineTimeoutError;
    // A transport failure's text can carry internals (hosts, stack traces);
    // the caller only learns that the engine did not take the run.
    logger.warn("macro trigger: engine call failed", { error: String(err), timedOut });
    const error = timedOut ? "the engine did not answer in time" : "the engine did not accept the run";
    await recordOutcome(error);
    return macroTriggerJson(timedOut ? 504 : 502, { ok: false, error });
  }
});

http.route({ path: MACRO_TRIGGER_PATH, method: "POST", handler: macroTriggerHandler });
http.route({ path: MACRO_TRIGGER_PATH, method: "GET", handler: macroTriggerHandler });
http.route({ pathPrefix: MACRO_TRIGGER_PATH_PREFIX, method: "POST", handler: macroTriggerHandler });
http.route({ pathPrefix: MACRO_TRIGGER_PATH_PREFIX, method: "GET", handler: macroTriggerHandler });

registerViewerAuthRoutes(http);
registerUserPageFormRoutes(http);
registerEngineEventRoutes(http);

export default http;
