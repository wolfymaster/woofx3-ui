import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { type BillingBanner, billingBanner } from "./lib/billingBanner";
import { engineAvailability } from "./lib/entitlementAccess";
import { orgCan, orgRoleOf } from "./lib/orgRoles";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * The billing banner for the engine the viewer is on, with whether they may
 * act on it (the owner). Null off hosted engines and when nothing is due.
 */
export const forViewer = query({
  args: { instanceId: v.id("instances"), now: v.number() },
  handler: async (ctx, { instanceId, now }): Promise<(BillingBanner & { canManageBilling: boolean }) | null> => {
    const userId = await getAuthUserId(ctx);
    const instance = await ctx.db.get(instanceId);
    if (userId === null || instance === null || (await getInstanceMembership(ctx, instanceId, userId)) === null) {
      return null;
    }
    const availability = await engineAvailability(ctx, instanceId, now);
    if (availability.availability !== "hosted") {
      return null;
    }
    const banner = billingBanner(availability.entitlements.subscription, now);
    const account = await ctx.db.get(instance.accountId);
    if (banner === null || account === null) {
      return null;
    }
    return { ...banner, canManageBilling: orgCan(await orgRoleOf(ctx, account, userId), "manageBilling") };
  },
});
