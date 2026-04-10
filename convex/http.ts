import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { logger } from "./logger";
import "./browserSource";
import "./obsCommands";

const http = httpRouter();

const CORS_HEADERS: Record<string, string> = process.env.CORS_ENABLED === "true"
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

    const redirectTo = await ctx.runMutation(internal.twitchAuth.validateAndConsumeState, { state });
    if (!redirectTo) {
      return errorRedirect(siteUrl, "invalid_state", "state not found or expired");
    }

    logger.info("state valid, exchanging code");

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

http.route({ path: "/api/webhooks/woofx3/alerts", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3/alerts",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    if (!payload.instanceId || !payload.eventType || !payload.user) {
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

http.route({ path: "/api/webhooks/woofx3/notify", method: "OPTIONS", handler: preflightHandler });
http.route({
  path: "/api/webhooks/woofx3/notify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.json();

    if (!payload.instanceId || !payload.type) {
      return corsJson({ error: "Missing required fields: instanceId, type" }, 400);
    }

    if (payload.type === "module.installed") {
      const p = payload.payload;
      if (!p?.name || !p?.version) {
        return corsJson({ error: "Missing module name/version in payload" }, 400);
      }

      await ctx.runMutation(internal.moduleWebhook.processModuleInstalled, {
        instanceId: payload.instanceId,
        moduleName: p.name,
        moduleVersion: p.version,
        triggers: p.triggers ?? [],
        actions: p.actions ?? [],
      });

      return corsJson({ success: true, type: "module.installed" });
    }

    // Future event types can be handled here
    return corsJson({ success: true, type: payload.type, handled: false });
  }),
});

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
      return corsJson({
        error: "Invalid source key",
        debug: { requestedKey: key.substring(0, 8) + "...", ...debugInfo },
      }, 401);
    }

    await ctx.runMutation(internal.browserSource.updateSourceKeyLastUsed, {
      keyId: sourceKey._id,
      lastUsedAt: Date.now(),
    });

    const scene = await ctx.runQuery(internal.browserSource.getScene, { sceneId: sourceKey.sceneId });
    const slots = await ctx.runQuery(internal.browserSource.getSceneSlots, { sceneId: sourceKey.sceneId });
    const alertDescriptors = await ctx.runQuery(internal.browserSource.getAlertDescriptorsForScene, { sceneId: sourceKey.sceneId });

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
          instanceId: string; sceneId: string; alertType: string; user: string;
          amount?: number; message?: string; tier?: string; createdAt: number;
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

export default http;
