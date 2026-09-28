import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { InstanceRole } from "./lib/instanceRoles";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * The signed-in caller's role on an instance, or null when signed out or not
 * a member. Lets a page hide or disable what the server would refuse; the
 * server still checks every change itself.
 */
export const role = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<InstanceRole | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    return membership?.role ?? null;
  },
});
