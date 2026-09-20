import { getAuthUserId } from "@convex-dev/auth/server";
import type { RegisterClientOptions } from "@woofx3/api/rpc";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { createEngineGatewaySession } from "./lib/engineInstanceUrl";
import { logger } from "./logger";

/**
 * Generate a cryptographically random hex string for use as a webhook callback token.
 */
function generateSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type RegisterResult = { ok: true; clientId: string; applicationId: string } | { ok: false; error: string };

/**
 * The registration handshake, as both onboarding paths run it.
 *
 * Internal because the managed path runs it from a scheduled retry with no
 * user request in flight, and because `registrationToken` is a secret the
 * browser must never hold: a managed engine is publicly reachable, and the
 * token is the only thing that stops the first caller from claiming it.
 * `userId` is the identity the engine attributes the client record to, passed
 * by the caller rather than read from the request for the same reason.
 */
export const registerWithEngine = internalAction({
  args: {
    instanceId: v.id("instances"),
    userId: v.id("users"),
    registrationToken: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, userId, registrationToken }): Promise<RegisterResult> => {
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.url) {
      return { ok: false, error: "The engine has no URL yet" };
    }

    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL is not configured");
    }
    const callbackUrl = `${siteUrl}/api/webhooks/woofx3`;

    // Per-instance callback token: the engine sends it as `Authorization:
    // Bearer <token>` on every callback, and it is how the webhook endpoint
    // decides which tenant a callback belongs to.
    const callbackToken = generateSecret();

    logger.info("registration: starting handshake", { instanceId, url: instance.url });

    try {
      // Each capnweb HTTP batch session is single-use, so connectivity and
      // registration are two sessions rather than two awaits on one.
      const pingGateway = createEngineGatewaySession(instance.url);
      await pingGateway.ping();

      // `registrationToken` is only understood by an engine provisioned with
      // one; a bring-your-own engine ignores the extra option.
      const options: RegisterClientOptions & { registrationToken?: string } = {
        userId,
        callbackUrl,
        callbackToken,
        ...(registrationToken ? { registrationToken } : {}),
      };
      const registerGateway = createEngineGatewaySession(instance.url);
      const result = await registerGateway.registerClient("woofx3-dashboard", options);

      logger.info("registration: handshake accepted", { instanceId, clientId: result.clientId });

      await ctx.runMutation(internal.instances.applyRegistration, {
        instanceId,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        webhookSecret: callbackToken,
        applicationId: result.applicationId,
      });

      return { ok: true, clientId: result.clientId, applicationId: result.applicationId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("registration: handshake failed", { instanceId, error: message });
      return { ok: false, error: message };
    }
  },
});

/**
 * Register an instance the user runs themselves ("bring your own engine").
 *
 * Managed engines do not come through here: they register from the
 * provisioning callback, with the token the maintenance API set on them.
 */
export const registerInstance = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<RegisterResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    // An instance id is not a secret, so without this any signed-in user could
    // register someone else's instance and receive its engine credentials.
    const membership = await ctx.runQuery(internal.instances.getMembership, { instanceId, userId });
    if (!membership || membership.role === "member") {
      throw new Error("Not authorized");
    }

    return await ctx.runAction(internal.registration.registerWithEngine, { instanceId, userId });
  },
});
