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
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<EngineAvailability | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    if ((await ctx.db.get(instanceId)) === null) {
      return null;
    }
    return engineAvailability(ctx, instanceId, Date.now());
  },
});

/** An account's entitlements, for operators: `bunx convex run entitlements:get '{"accountId": "…"}'` */
export const get = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Entitlements> => {
    return accountEntitlements(ctx, accountId, Date.now());
  },
});
