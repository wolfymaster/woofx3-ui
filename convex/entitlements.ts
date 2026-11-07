import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { accountEntitlements, type EngineAvailability, engineAvailability } from "./lib/entitlementAccess";
import type { Entitlements } from "./lib/entitlements";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * What the engine offers, for a member of it: self-hosted, or hosted with its
 * org's entitlements and subscription. Null for a non-member or a missing
 * instance: an instance id is not a secret.
 */
export const forViewer = query({
  args: { instanceId: v.id("instances"), now: v.number() },
  handler: async (ctx, { instanceId, now }): Promise<EngineAvailability | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    if ((await ctx.db.get(instanceId)) === null) {
      return null;
    }
    return engineAvailability(ctx, instanceId, now);
  },
});

/**
 * An account's entitlements at `now` (ms), for operators:
 * `bunx convex run entitlements:get "{\"accountId\": \"…\", \"now\": $(date +%s000)}"`
 */
export const get = internalQuery({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: async (ctx, { accountId, now }): Promise<Entitlements> => {
    return accountEntitlements(ctx, accountId, now);
  },
});
