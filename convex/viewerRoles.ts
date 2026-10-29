import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
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
import { viewerRateLimiter } from "./lib/viewerRateLimits";
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
      error:
        | "not_signed_in"
        | "broadcaster_not_linked"
        | "platform_mismatch"
        | "reauth_required"
        | "rate_limited"
        | "unavailable";
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
      v.literal("rate_limited"),
      v.literal("unavailable")
    ),
  })
);

interface RefreshContext {
  session: { expiresAt: number };
  viewer: { _id: Id<"viewers">; platform: ViewerPlatform; platformUserId: string };
  broadcaster: { platform: ViewerPlatform; platformUserId: string } | null;
  cached: ViewerRoles | null;
  outage: { failedAt: number } | null;
  tokens: Doc<"viewerPlatformTokens"> | null;
}

/** The outage row for one viewer on one broadcaster's channel, if any. */
async function outageRow(
  ctx: QueryCtx,
  viewerId: Id<"viewers">,
  platform: ViewerPlatform,
  broadcasterPlatformUserId: string
): Promise<Doc<"viewerRoleOutages"> | null> {
  return ctx.db
    .query("viewerRoleOutages")
    .withIndex("by_viewer_and_platform_and_broadcaster", (q) =>
      q.eq("viewerId", viewerId).eq("platform", platform).eq("broadcasterPlatformUserId", broadcasterPlatformUserId)
    )
    .unique();
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
    const outage = broadcaster ? await outageRow(ctx, viewer._id, viewer.platform, broadcaster.platformUserId) : null;
    const tokens = await ctx.db
      .query("viewerPlatformTokens")
      .withIndex("by_viewer", (q) => q.eq("viewerId", viewer._id))
      .unique();
    return {
      session: { expiresAt: session.expiresAt },
      viewer: { _id: viewer._id, platform: viewer.platform, platformUserId: viewer.platformUserId },
      broadcaster,
      cached,
      outage: outage ? { failedAt: outage.failedAt } : null,
      tokens,
    };
  },
});

const renewedTokensValidator = v.object({
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
});

const channelOutcomeValidator = v.object({
  platform: viewerPlatformValidator,
  broadcasterPlatformUserId: v.string(),
  result: v.union(
    v.object({
      kind: v.literal("checked"),
      follower: v.boolean(),
      subscriberTier: subscriberTierValidator,
      checkedAt: v.number(),
    }),
    v.object({ kind: v.literal("unavailable"), failedAt: v.number() })
  ),
});

export interface RefreshRecord {
  viewerId: Id<"viewers">;
  tokens?: typeof renewedTokensValidator.type;
  channel?: typeof channelOutcomeValidator.type;
}

/**
 * Writes what a refresh learned: renewed tokens (unless a new sign-in replaced
 * the grant meanwhile) or a refused grant, and for the channel either the new
 * roles, which end any outage, or the time the platform could not answer.
 */
export async function recordViewerRoleRefresh(ctx: MutationCtx, record: RefreshRecord, now: number): Promise<void> {
  const { viewerId, tokens, channel } = record;
  if (tokens) {
    const row = await ctx.db
      .query("viewerPlatformTokens")
      .withIndex("by_viewer", (q) => q.eq("viewerId", viewerId))
      .unique();
    if (row && refreshOutcomeApplies({ refreshToken: row.sealedRefreshToken }, tokens.usedSealedRefreshToken)) {
      if (tokens.renewed) {
        await ctx.db.patch(row._id, tokens.renewed);
      } else {
        await ctx.db.patch(row._id, { authFailedAt: now });
      }
    }
  }
  if (!channel) {
    return;
  }
  const { platform, broadcasterPlatformUserId, result } = channel;
  const outage = await outageRow(ctx, viewerId, platform, broadcasterPlatformUserId);
  if (result.kind === "unavailable") {
    if (outage) {
      await ctx.db.patch(outage._id, { failedAt: result.failedAt });
    } else {
      await ctx.db.insert("viewerRoleOutages", {
        viewerId,
        platform,
        broadcasterPlatformUserId,
        failedAt: result.failedAt,
      });
    }
    return;
  }
  if (outage) {
    await ctx.db.delete(outage._id);
  }
  const roles = {
    platform,
    broadcasterPlatformUserId,
    follower: result.follower,
    subscriberTier: result.subscriberTier,
    checkedAt: result.checkedAt,
  };
  const existing = await ctx.db
    .query("viewerRoles")
    .withIndex("by_viewer_and_platform_and_broadcaster", (q) =>
      q.eq("viewerId", viewerId).eq("platform", platform).eq("broadcasterPlatformUserId", broadcasterPlatformUserId)
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, roles);
  } else {
    await ctx.db.insert("viewerRoles", { viewerId, ...roles });
  }
}

export const recordRefresh = internalMutation({
  args: {
    viewerId: v.id("viewers"),
    tokens: v.optional(renewedTokensValidator),
    channel: v.optional(channelOutcomeValidator),
  },
  returns: v.null(),
  handler: async (ctx, record) => {
    await recordViewerRoleRefresh(ctx, record, Date.now());
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
    const { viewer, broadcaster, cached, outage, tokens } = context;
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
      outage,
      grant,
      viewerPlatformUserId: viewer.platformUserId,
      broadcasterPlatformUserId: broadcaster.platformUserId,
      admit: async () => (await viewerRateLimiter.limit(ctx, "viewerRolesRefresh", { key: viewer._id })).ok,
    });

    if (outcome.kind === "cached") {
      return { ok: true, ...outcome.roles };
    }
    if (outcome.kind === "rate_limited") {
      return { ok: false, error: "rate_limited" };
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
    const channel = { platform: viewer.platform, broadcasterPlatformUserId: broadcaster.platformUserId };
    if (outcome.kind === "unavailable") {
      if (outcome.fromOutage) {
        return { ok: false, error: "unavailable" };
      }
      await ctx.runMutation(internal.viewerRoles.recordRefresh, {
        viewerId: viewer._id,
        tokens: await sealRenewed(outcome.refreshedGrant),
        channel: { ...channel, result: { kind: "unavailable", failedAt: now } },
      });
      logger.warn("viewer role check unavailable", { platform: viewer.platform });
      return { ok: false, error: "unavailable" };
    }

    const roles = { ...outcome.roles, checkedAt: now };
    await ctx.runMutation(internal.viewerRoles.recordRefresh, {
      viewerId: viewer._id,
      tokens: await sealRenewed(outcome.refreshedGrant),
      channel: { ...channel, result: { kind: "checked", ...roles } },
    });
    return { ok: true, ...roles };
  },
});
