import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { accountEntitlements } from "./lib/entitlementAccess";
import type { Entitlements } from "./lib/entitlements";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * The entitlements of the account that owns an instance, for a member of it.
 * Null for a non-member or a missing instance: an instance id is not a secret.
 */
export const forViewer = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Entitlements | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const instance = await ctx.db.get(instanceId);
    if (!instance) {
      return null;
    }
    return accountEntitlements(ctx, instance.accountId);
  },
});

/** An account's entitlements, for operators: `bunx convex run entitlements:get '{"accountId": "…"}'` */
export const get = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Entitlements> => {
    return accountEntitlements(ctx, accountId);
  },
});
