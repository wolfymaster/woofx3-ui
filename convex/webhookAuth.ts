import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

/**
 * Look up the webhook secret for a given instanceId.
 * Returns null if no secret is configured.
 *
 * TODO: When per-instance secrets are stored in the DB (established during
 * the registration handshake), look them up here by instanceId. For now
 * we use a single shared secret from the environment.
 */
export const getWebhookSecret = internalQuery({
  args: { instanceId: v.string() },
  handler: async (_ctx, _args) => {
    const secret = process.env.WEBHOOK_SECRET;
    return secret ?? null;
  },
});
