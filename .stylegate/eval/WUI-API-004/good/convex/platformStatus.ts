import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

function withoutWebhookSecret(instance: Doc<"instances">): Omit<Doc<"instances">, "webhookSecret"> {
  const { webhookSecret: _webhookSecret, ...rest } = instance;
  return rest;
}

export const twitchLink = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .first();
    if (!link) {
      return null;
    }
    return {
      platform: link.platform,
      platformUsername: link.platformUsername,
      scopes: link.scopes,
      expiresAt: link.expiresAt,
      hasRefreshToken: link.sealedRefreshToken.length > 0,
    };
  },
});

export const instanceForMember = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    await requireInstanceRole(ctx, args.instanceId);
    const instance = await ctx.db.get(args.instanceId);
    return instance ? withoutWebhookSecret(instance) : null;
  },
});
