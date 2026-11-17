import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { featureFlagSubject } from "./lib/featureFlagAccess";
import { isFlagOn } from "./lib/featureFlags";

/**
 * Every flag's answer for the signed-in user on an instance, keyed by flag
 * key. Flags are few, so one subscription answers the whole page and updates
 * as soon as an operator changes a flag. A key with no row is absent, which
 * the browser hook reads as off; a signed-out viewer gets no flags at all.
 *
 * Flags are created and targeted in the backoffice, through the ops API
 * (convex/ops/featureFlags.ts).
 */
export const forViewer = query({
  args: { instanceId: v.optional(v.id("instances")) },
  handler: async (ctx, { instanceId }): Promise<Record<string, boolean>> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {};
    }
    const subject = await featureFlagSubject(ctx, userId, instanceId);
    const rows = await ctx.db.query("featureFlags").take(500);
    const answers: Record<string, boolean> = {};
    for (const row of rows) {
      answers[row.key] = isFlagOn(row, subject);
    }
    return answers;
  },
});
