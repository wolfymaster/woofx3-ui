import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { hashOpaqueToken, isOpaqueToken } from "./lib/oauthHandoff";
import { refreshOutcomeApplies } from "./lib/twitchRefresh";
import {
  type SubscriberTier,
  subscriberTierValidator,
  type ViewerPlatform,
  type ViewerRoles,
  viewerPlatformValidator,
  viewerSessionLive,
} from "./lib/viewerAuth";
import { type ViewerTokenGrant, viewerPlatformClient } from "./lib/viewerPlatforms";
import { refreshViewerRoles } from "./lib/viewerRoleRefresh";
import { broadcasterForInstance, viewerRolesFor } from "./lib/viewerSessionAuth";
import { openViewerToken, sealViewerToken, viewerTokenKeyFromEnv } from "./lib/viewerTokenCipher";
import { logger } from "./logger";

// Keeps a viewer's follower and subscriber status on one broadcaster's channel
// current, asking the platform with the viewer's own token. Page queries read
// the cached result through `viewerRolesFor`; a page calls `refresh` when what
// it has is missing or older than VIEWER_ROLES_TTL_MS.

export type RefreshRolesResult =
  | { ok: true; follower: boolean; subscriberTier: SubscriberTier | null; checkedAt: number }
  | {
      ok: false;
      error: "not_signed_in" | "broadcaster_not_linked" | "platform_mismatch" | "reauth_required" | "unavailable";
    };

const refreshRolesResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    follower: v.boolean(),
    subscriberTier: subscriberTierValidator,
    checkedAt: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    error: v.union(
      v.literal("not_signed_in"),
      v.literal("broadcaster_not_linked"),
      v.literal("platform_mismatch"),
      v.literal("reauth_required"),
      v.literal("unavailable")
    ),
  })
);

interface RefreshContext {
  session: { expiresAt: number };
  viewer: { _id: Id<"viewers">; platform: ViewerPlatform; platformUserId: string };
  broadcaster: { platform: ViewerPlatform; platformUserId: string } | null;
  cached: ViewerRoles | null;
  tokens: Doc<"viewerPlatformTokens"> | null;
}

/** Internal: the result carries the viewer's sealed tokens. */
export const refreshContext = internalQuery({
  args: { sessionTokenHash: v.string(), instanceId: v.id("instances") },
  handler: async (ctx, { sessionTokenHash, instanceId }): Promise<RefreshContext | null> => {
    const session = await ctx.db
      .query("viewerSessions")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", sessionTokenHash))
      .unique();
    if (!session) {
      return null;
    }
    const viewer = await ctx.db.get(session.viewerId);
    if (!viewer) {
      throw new Error(`viewer session ${session._id} names a viewer that does not exist`);
    }
    const broadcaster = await broadcasterForInstance(ctx, instanceId);
    const cached = broadcaster ? await viewerRolesFor(ctx, viewer._id, broadcaster.platformUserId) : null;
    const tokens = await ctx.db
      .query("viewerPlatformTokens")
      .withIndex("by_viewer", (q) => q.eq("viewerId", viewer._id))
      .unique();
    return {
      session: { expiresAt: session.expiresAt },
      viewer: { _id: viewer._id, platform: viewer.platform, platformUserId: viewer.platformUserId },
      broadcaster,
      cached,
      tokens,
    };
  },
});

/**
 * Writes what a refresh learned: renewed tokens (unless a new sign-in replaced
 * the grant meanwhile), a refused grant, and the roles themselves.
 */
export const recordRefresh = internalMutation({
  args: {
    viewerId: v.id("viewers"),
    tokens: v.optional(
      v.object({
        usedSealedRefreshToken: v.string(),
        renewed: v.union(
          v.null(),
          v.object({
            sealedAccessToken: v.string(),
            sealedRefreshToken: v.string(),
            expiresAt: v.number(),
            scopes: v.array(v.string()),
          })
        ),
      })
    ),
    roles: v.optional(
      v.object({
        platform: viewerPlatformValidator,
        broadcasterPlatformUserId: v.string(),
        follower: v.boolean(),
        subscriberTier: subscriberTierValidator,
        checkedAt: v.number(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { viewerId, tokens, roles }) => {
    if (tokens) {
      const row = await ctx.db
        .query("viewerPlatformTokens")
        .withIndex("by_viewer", (q) => q.eq("viewerId", viewerId))
        .unique();
      if (row && refreshOutcomeApplies({ refreshToken: row.sealedRefreshToken }, tokens.usedSealedRefreshToken)) {
        if (tokens.renewed) {
          await ctx.db.patch(row._id, tokens.renewed);
        } else {
          await ctx.db.patch(row._id, { authFailedAt: Date.now() });
        }
      }
    }
    if (roles) {
      const existing = await ctx.db
        .query("viewerRoles")
        .withIndex("by_viewer_and_platform_and_broadcaster", (q) =>
          q
            .eq("viewerId", viewerId)
            .eq("platform", roles.platform)
            .eq("broadcasterPlatformUserId", roles.broadcasterPlatformUserId)
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, roles);
      } else {
        await ctx.db.insert("viewerRoles", { viewerId, ...roles });
      }
    }
    return null;
  },
});

/**
 * The signed-in viewer's roles on the channel `instanceId` streams on, from
 * the cache while it is fresh and from the platform otherwise.
 */
export const refresh = action({
  args: { sessionToken: v.string(), instanceId: v.id("instances") },
  returns: refreshRolesResultValidator,
  handler: async (ctx, { sessionToken, instanceId }): Promise<RefreshRolesResult> => {
    if (!isOpaqueToken(sessionToken)) {
      return { ok: false, error: "not_signed_in" };
    }
    const now = Date.now();
    const context: RefreshContext | null = await ctx.runQuery(internal.viewerRoles.refreshContext, {
      sessionTokenHash: await hashOpaqueToken(sessionToken),
      instanceId,
    });
    if (context === null || !viewerSessionLive(context.session, now)) {
      return { ok: false, error: "not_signed_in" };
    }
    const { viewer, broadcaster, cached, tokens } = context;
    if (broadcaster === null) {
      return { ok: false, error: "broadcaster_not_linked" };
    }
    if (broadcaster.platform !== viewer.platform) {
      return { ok: false, error: "platform_mismatch" };
    }

    const key = await viewerTokenKeyFromEnv();
    const grant: ViewerTokenGrant | null =
      tokens && tokens.authFailedAt === undefined
        ? {
            accessToken: await openViewerToken(key, tokens.sealedAccessToken),
            refreshToken: await openViewerToken(key, tokens.sealedRefreshToken),
            expiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
          }
        : null;

    const outcome = await refreshViewerRoles({
      client: viewerPlatformClient(viewer.platform),
      now,
      cached,
      grant,
      viewerPlatformUserId: viewer.platformUserId,
      broadcasterPlatformUserId: broadcaster.platformUserId,
    });

    if (outcome.kind === "cached") {
      return { ok: true, ...outcome.roles };
    }

    const sealRenewed = async (renewed: ViewerTokenGrant | null) => {
      if (renewed === null || tokens === null) {
        return undefined;
      }
      return {
        usedSealedRefreshToken: tokens.sealedRefreshToken,
        renewed: {
          sealedAccessToken: await sealViewerToken(key, renewed.accessToken),
          sealedRefreshToken: await sealViewerToken(key, renewed.refreshToken),
          expiresAt: renewed.expiresAt,
          scopes: renewed.scopes,
        },
      };
    };

    if (outcome.kind === "reauth_required") {
      if (outcome.revoked && tokens !== null) {
        await ctx.runMutation(internal.viewerRoles.recordRefresh, {
          viewerId: viewer._id,
          tokens: { usedSealedRefreshToken: tokens.sealedRefreshToken, renewed: null },
        });
      }
      return { ok: false, error: "reauth_required" };
    }
    if (outcome.kind === "unavailable") {
      const renewedTokens = await sealRenewed(outcome.refreshedGrant);
      if (renewedTokens) {
        await ctx.runMutation(internal.viewerRoles.recordRefresh, { viewerId: viewer._id, tokens: renewedTokens });
      }
      logger.warn("viewer role check unavailable", { platform: viewer.platform });
      return { ok: false, error: "unavailable" };
    }

    const roles = { ...outcome.roles, checkedAt: now };
    await ctx.runMutation(internal.viewerRoles.recordRefresh, {
      viewerId: viewer._id,
      tokens: await sealRenewed(outcome.refreshedGrant),
      roles: { platform: viewer.platform, broadcasterPlatformUserId: broadcaster.platformUserId, ...roles },
    });
    return { ok: true, ...roles };
  },
});
