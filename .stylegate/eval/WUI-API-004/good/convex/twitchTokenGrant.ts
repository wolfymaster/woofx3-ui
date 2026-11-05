import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { logger } from "./logger";

export const grantTokenToEngine = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const grant = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, args);
    if (!grant) {
      logger.warn("no linked Twitch account to grant a token for", { instanceId: args.instanceId });
      return { ok: false as const, reason: "not_linked" };
    }
    return { ok: true as const, accessToken: grant.accessToken, expiresAt: grant.expiresAt, login: grant.login };
  },
});

export const refreshFailed = internalAction({
  args: { instanceId: v.id("instances"), status: v.number() },
  handler: async (_ctx, args) => {
    logger.error("twitch token refresh failed", { instanceId: args.instanceId, status: args.status, refreshToken: "[redacted]" });
  },
});
