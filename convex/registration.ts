import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { createGatewaySession } from "./lib/engineInstanceUrl";

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

type RegisterResult = { ok: true; clientId: string; clientSecret: string } | { ok: false; error: string };

/**
 * Register a Convex instance with a woofx3 engine deployment.
 *
 * Connects to the engine's ApiGateway via capnweb, calls registerClient()
 * to obtain client credentials, and stores them on the instance record.
 */
export const registerInstance = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<RegisterResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }

    // Build the webhook callback URL from the Convex site URL
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL is not configured");
    }
    const callbackUrl = `${siteUrl}/api/webhooks/woofx3`;

    // Generate a per-instance callback token (webhookSecret).
    // The engine will include this as Authorization: Bearer <token> on every callback.
    const callbackToken = generateSecret();

    console.log(`[registerInstance] Registering instance "${instanceId}" at ${instance.url}`);

    try {
      // Verify engine connectivity (separate HTTP batch — consumed on await)
      const pingGateway = createGatewaySession(instance.url);
      await pingGateway.ping();

      // Register as a client (new HTTP batch session — each batch is single-use)
      const registerGateway = createGatewaySession(instance.url);
      const result = await registerGateway.registerClient("woofx3-dashboard", callbackUrl, callbackToken);

      console.log(`[registerInstance] Registration successful — clientId=${result.clientId}`);

      // Persist the handshake results
      await ctx.runMutation(internal.instances.applyRegistration, {
        instanceId,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
        webhookSecret: callbackToken,
      });

      return {
        ok: true,
        clientId: result.clientId,
        clientSecret: result.clientSecret,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[registerInstance] Failed: ${message}`);
      return { ok: false, error: message };
    }
  },
});
