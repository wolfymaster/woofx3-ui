import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { safeRelativePath } from "./lib/safeRedirect";
import { TWITCH_INTEGRATION_SCOPES } from "./lib/twitchIntegrationScopes";
import { canManageTwitchLink } from "./lib/twitchLinkPolicy";

/** The signed-in caller, when they may connect or disconnect this instance's Twitch link. */
async function requireTwitchLinkManager(ctx: ActionCtx, instanceId: Id<"instances">): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const role = await ctx.runQuery(internal.instances.memberRole, { instanceId, userId });
  if (!canManageTwitchLink(role)) {
    throw new Error("Only an owner or admin of this instance can connect or disconnect Twitch");
  }
  return userId;
}

/**
 * Start connecting (or reconnecting) Twitch for an instance: records who asked
 * in a one-time OAuth state and returns Twitch's authorize URL for the browser
 * to navigate to. Minting the state here, behind authentication, is what ties
 * the callback to an owner or admin; the HTTP callback accepts nothing else.
 */
export const startConnect = action({
  args: { instanceId: v.id("instances"), redirectTo: v.string() },
  handler: async (ctx, { instanceId, redirectTo }): Promise<{ authorizeUrl: string }> => {
    const userId = await requireTwitchLinkManager(ctx, instanceId);

    const clientId = process.env.AUTH_TWITCH_ID;
    const redirectUri = process.env.AUTH_TWITCH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      throw new Error("AUTH_TWITCH_ID and AUTH_TWITCH_REDIRECT_URI must be set");
    }

    const state = crypto.randomUUID();
    await ctx.runMutation(internal.twitchAuth.storeState, {
      state,
      redirectTo: safeRelativePath(redirectTo, "/admin/integrations"),
      instanceId,
      userId,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: TWITCH_INTEGRATION_SCOPES.join(" "),
      state,
    });
    return { authorizeUrl: `https://id.twitch.tv/oauth2/authorize?${params}` };
  },
});

export const upsertPlatformLink = internalMutation({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
    platformUserId: v.string(),
    platformUsername: v.string(),
    profileImageUrl: v.optional(v.string()),
    channelId: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), args.platform))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("platformLinks", args);
    }
  },
});

export const getLinkAndInstance = internalQuery({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
  },
  handler: async (ctx, { instanceId, platform }) => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), platform))
      .first();
    const instance = await ctx.db.get(instanceId);
    return { link, instance };
  },
});

export const deletePlatformLink = internalMutation({
  args: { linkId: v.id("platformLinks") },
  handler: async (ctx, { linkId }) => {
    await ctx.db.delete(linkId);
  },
});

export const syncToEngine = internalAction({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const { link, instance } = await ctx.runQuery(internal.twitchIntegration.getLinkAndInstance, {
      instanceId,
      platform: "twitch",
    });

    if (!link) {
      throw new Error("No Twitch platform link found for instance");
    }
    if (!instance) {
      throw new Error("Instance not found");
    }
    if (!instance.clientId || !instance.clientSecret) {
      throw new Error("Instance not registered with engine");
    }

    const engine = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);

    const token = {
      userId: link.platformUserId,
      accessToken: link.accessToken,
      refreshToken: link.refreshToken,
      expiresIn: Math.max(0, Math.floor((link.expiresAt - Date.now()) / 1000)),
      obtainmentTimestamp: Date.now(),
      scope: link.scopes,
    };

    await engine.setTwitchToken(token, link.connectedByUserId ?? undefined);
  },
});

export const disconnect = action({
  args: {
    instanceId: v.id("instances"),
    platform: v.string(),
  },
  handler: async (ctx, { instanceId, platform }) => {
    await requireTwitchLinkManager(ctx, instanceId);
    const { link, instance } = await ctx.runQuery(internal.twitchIntegration.getLinkAndInstance, {
      instanceId,
      platform,
    });

    if (!link) {
      return { ok: true };
    }

    if (instance?.clientId && instance?.clientSecret) {
      try {
        const engine = createEngineRpcSession<EngineApi>(instance.url, instance.clientId, instance.clientSecret);
        await engine.deleteTwitchToken();
      } catch (err) {
        console.warn("[disconnect] engine.deleteTwitchToken failed (proceeding with local delete)", err);
      }
    }

    await ctx.runMutation(internal.twitchIntegration.deletePlatformLink, { linkId: link._id });
    return { ok: true };
  },
});
