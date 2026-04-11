import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { engineHttpBatchApiUrl } from "./lib/engineInstanceUrl";

/**
 * Generate a cryptographically random hex string for use as a webhook secret.
 */
function generateSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type RegistrationResponse = {
  status: string;
  instanceId: string;
  applicationId: string;
  apiKey?: string;
};

type RegisterResult =
  | { ok: true; applicationId: string; apiKey: string | null }
  | { ok: false; error: string };

/**
 * Register a Convex instance with a woofx3 engine deployment.
 *
 * Generates a webhook secret, POSTs to the engine's /api/register endpoint,
 * and stores the engine-returned applicationId + apiKey back on the instance record.
 */
export const registerInstance = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<RegisterResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    // Read the instance to get its URL
    const instance = await ctx.runQuery(internal.instances.getInternal, { instanceId });
    if (!instance) {
      throw new Error("Instance not found");
    }

    // Build the webhook URL from the Convex site URL
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) {
      throw new Error("CONVEX_SITE_URL is not configured");
    }
    const webhookUrl = `${siteUrl}/api/webhooks/woofx3/notify`;

    // Generate a per-instance webhook secret
    const webhookSecret = generateSecret();

    // Build the engine registration URL (reuse the same URL normalizer, but target /api/register)
    const apiUrl = engineHttpBatchApiUrl(instance.url);
    // engineHttpBatchApiUrl returns "<origin>/api" — replace with /api/register
    const registerUrl = apiUrl.replace(/\/api$/, "/api/register");

    console.log(`[registerInstance] Registering instance "${instanceId}" at ${registerUrl}`);

    try {
      const response = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId,
          webhookUrl,
          webhookSecret,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error(`[registerInstance] Engine returned ${response.status}: ${text}`);
        return { ok: false, error: `Engine returned ${response.status}: ${text}` };
      }

      const result = (await response.json()) as RegistrationResponse;
      console.log(`[registerInstance] Registration successful — applicationId=${result.applicationId}`);

      // Persist the handshake results
      await ctx.runMutation(internal.instances.applyRegistration, {
        instanceId,
        applicationId: result.applicationId,
        webhookSecret,
        apiKey: result.apiKey,
      });

      return {
        ok: true,
        applicationId: result.applicationId,
        apiKey: result.apiKey ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[registerInstance] Failed: ${message}`);
      return { ok: false, error: message };
    }
  },
});
