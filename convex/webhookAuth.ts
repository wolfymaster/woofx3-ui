import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

/**
 * Look up the webhook secret (callbackToken) for a given instanceId.
 *
 * Returns the per-instance secret established during the registration handshake.
 */
export const getWebhookSecret = internalQuery({
  args: { instanceId: v.string() },
  handler: async (ctx, { instanceId }) => {
    try {
      const instance = await ctx.db.get(instanceId as Id<"instances">);
      return instance?.webhookSecret ?? null;
    } catch {
      return null;
    }
  },
});
