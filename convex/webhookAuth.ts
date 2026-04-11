import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

/**
 * Look up the webhook secret for a given instanceId.
 *
 * Checks the per-instance secret established during the registration handshake.
 * Falls back to the shared WEBHOOK_SECRET env var for instances registered
 * before per-instance secrets were introduced.
 */
export const getWebhookSecret = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, { instanceId }) => {
    // instanceId is the Convex _id of the instance record
    try {
      const instance = await ctx.db.get(instanceId as Id<"instances">);
      if (instance?.webhookSecret) {
        return instance.webhookSecret;
      }
    } catch {
      // Invalid ID format — fall through to env var
    }

    // Fallback to shared env var for legacy instances
    const secret = process.env.WEBHOOK_SECRET;
    return secret ?? null;
  },
});
