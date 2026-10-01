import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { readMemberRole } from "./instances";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { oauthCallbackUrl } from "./lib/oauthCallback";
import type { OAuthErrorCode } from "./lib/oauthErrors";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { mintOAuthState, oauthStateConfigFromEnv } from "./lib/oauthState";
import { safeRelativePath } from "./lib/safeRedirect";
import { TWITCH_INTEGRATION_SCOPES } from "./lib/twitchIntegrationScopes";
import { canManageTwitchLink, relinkRefusal } from "./lib/twitchLinkPolicy";
import { claimHandoff } from "./oauthConnectHandoff";

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
    if (!clientId) {
      throw new Error("AUTH_TWITCH_ID must be set");
    }
    const redirectUri = oauthCallbackUrl("twitch");

    const state = await mintOAuthState(oauthStateConfigFromEnv());
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
      // Twitch skips its consent screen for an account that authorized this
      // app before; forcing it means a connect never completes unseen.
      force_verify: "true",
    });
    return { authorizeUrl: `https://id.twitch.tv/oauth2/authorize?${params}` };
  },
});

type ConnectRefusal = { ok: false; error: OAuthErrorCode; detail?: string };

export type FinishConnectResult = { ok: true; redirectTo: string } | ConnectRefusal;

type CompletedConnect = { ok: true; redirectTo: string; instanceId: Id<"instances"> };

/**
 * Claims the Twitch result the OAuth callback stored under `codeHash` and
 * writes the instance's link. Claiming, the role check, the relink check and
 * the write happen in this one transaction.
 */
export const completeConnect = internalMutation({
  args: { codeHash: v.string(), userId: v.id("users") },
  handler: async (ctx, { codeHash, userId }): Promise<CompletedConnect | ConnectRefusal> => {
    const claim = await claimHandoff(ctx, codeHash, "twitch", userId);
    if (!claim.ok) {
      return { ok: false, error: claim.error };
    }
    const { instanceId, redirectTo, twitch } = claim.row;
    if (!twitch) {
      throw new Error("Twitch handoff without a Twitch result");
    }
    if (!canManageTwitchLink(await readMemberRole(ctx, instanceId, userId))) {
      return { ok: false, error: "not_permitted" };
    }

    const existing = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    const refusal = relinkRefusal(existing, twitch.platformUserId);
    if (refusal) {
      return { ok: false, error: "relink_mismatch", detail: refusal };
    }

    const link = {
      instanceId,
      platform: "twitch",
      platformUserId: twitch.platformUserId,
      platformUsername: twitch.platformUsername,
      profileImageUrl: twitch.profileImageUrl,
      channelId: twitch.platformUserId,
      accessToken: twitch.accessToken,
      refreshToken: twitch.refreshToken,
      expiresAt: twitch.expiresAt,
      scopes: twitch.scopes,
      connectedByUserId: userId,
    };
    if (existing) {
      // A fresh grant supersedes a refresh Twitch refused earlier.
      await ctx.db.patch(existing._id, { ...link, authFailedAt: undefined });
    } else {
      await ctx.db.insert("platformLinks", link);
    }
    return { ok: true, redirectTo, instanceId };
  },
});

/**
 * Finishes a Twitch connect from the browser that the OAuth callback
 * redirected, with the one-time code it was given. Only the signed-in user
 * who started the connect can finish it, so a connect link opened by anyone
 * else links nothing.
 */
export const finishConnect = action({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<FinishConnectResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { ok: false, error: "not_signed_in" };
    }
    if (!isOpaqueToken(code)) {
      return { ok: false, error: "connect_code_invalid" };
    }
    const result = await ctx.runMutation(internal.twitchIntegration.completeConnect, {
      codeHash: await hashOpaqueToken(code),
      userId,
    });
    if (!result.ok) {
      return result;
    }
    try {
      await ctx.runAction(internal.twitchIntegration.syncToEngine, { instanceId: result.instanceId });
    } catch (err) {
      console.error("[twitch-connect] engine sync failed after saving the link", String(err));
    }
    return { ok: true, redirectTo: result.redirectTo };
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
