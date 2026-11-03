import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { logger } from "./logger";

export const pushTwitchCredentials = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const instance = await ctx.runQuery(internal.instances.getInternal, args);
    const link = await ctx.runQuery(internal.platformLinks.unsealedTwitchLink, args);
    if (!instance?.clientId || !instance.clientSecret || !link) {
      return;
    }
    await createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret).setTwitchCredentials({
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      login: link.platformUsername,
    });
  },
});

export const exchangeCode = internalAction({
  args: { code: v.string(), redirectUri: v.string() },
  handler: async (_ctx, args) => {
    const body = new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID ?? "",
      client_secret: process.env.TWITCH_CLIENT_SECRET ?? "",
      code: args.code,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
    });
    const response = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body });
    if (!response.ok) {
      logger.error("twitch code exchange failed", { status: response.status, request: body.toString() });
      throw new Error("Twitch refused the sign-in code");
    }
    return (await response.json()) as { access_token: string; expires_in: number };
  },
});
