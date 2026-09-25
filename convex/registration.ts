import { getAuthUserId } from "@convex-dev/auth/server";
import type { RegisterClientOptions } from "@woofx3/api/rpc";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action } from "./_generated/server";
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

type RegisterResult = { ok: true; clientId: string } | { ok: false; error: string };

/**
 * The registration handshake, as both onboarding paths run it: the user
 * connecting their own engine, and the managed flow's scheduled retry after
 * the maintenance API reports an engine ready.
 *
 * A plain function rather than its own action because both callers already run
 * in an action — an action calling an action only adds a hop.
 * `registrationToken` is the secret a managed engine demands from whoever
 * claims it; it is chosen by the caller, never read from a browser request.
 */
export async function performRegistration(
  ctx: ActionCtx,
  { instanceId, registrationToken }: { instanceId: Id<"instances">; registrationToken?: string }
): Promise<RegisterResult> {
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
    const options: RegisterClientOptions = {
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
    });

    return { ok: true, clientId: result.clientId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("registration: handshake failed", { instanceId, error: message });
    return { ok: false, error: message };
  }
}

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

    return await performRegistration(ctx, { instanceId });
  },
});
