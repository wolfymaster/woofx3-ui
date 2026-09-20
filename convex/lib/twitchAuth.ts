import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalQuery } from "../_generated/server";

// Shared authorization for Convex actions that call Twitch Helix on the
// broadcaster's behalf. One copy deliberately: the scope check below is the
// only thing that turns a silent 401 into something actionable, and a second
// copy is how that protection drifts out of sync.

export interface AuthorizedTwitchCall {
  accessToken: string;
  broadcasterUserId: string;
  clientId: string;
}

/** Scopes granted on this instance's Twitch link. Internal: the link row also
 * carries the access and refresh tokens, which must never leave the backend. */
export const twitchScopesFor = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string[]> => {
    const link = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .filter((q) => q.eq(q.field("platform"), "twitch"))
      .first();
    return link?.scopes ?? [];
  },
});

/**
 * Authenticates the caller, confirms the instance's Twitch link carries the
 * scope this call needs, and returns a fresh token. The scope check is what
 * turns "Twitch silently 401s" into an actionable "reconnect Twitch" message:
 * a link created before a scope was added to TWITCH_INTEGRATION_SCOPES keeps
 * working for everything else, so the gap is invisible until it isn't.
 */
export async function authorizeTwitch(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  requiredScope: string
): Promise<AuthorizedTwitchCall> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const isMember = await ctx.runQuery(internal.platformRealtime.checkMembership, { instanceId, userId });
  if (!isMember) {
    throw new Error("Not a member of this instance");
  }

  return authorizeTwitchUnattended(ctx, instanceId, requiredScope);
}

/**
 * The same token and scope work without the caller check, for a scheduled job
 * that has no authenticated user behind it. Never reachable from a client:
 * every public entry point goes through `authorizeTwitch` above.
 */
export async function authorizeTwitchUnattended(
  ctx: ActionCtx,
  instanceId: Id<"instances">,
  requiredScope: string
): Promise<AuthorizedTwitchCall> {
  const scopes: string[] = await ctx.runQuery(internal.lib.twitchAuth.twitchScopesFor, { instanceId });
  if (!scopes.includes(requiredScope)) {
    throw new Error(
      `Your Twitch connection is missing the "${requiredScope}" permission. Reconnect Twitch in Settings → Integrations to grant it.`
    );
  }

  const token = await ctx.runAction(internal.platformRealtime.ensureFreshTwitchToken, { instanceId });
  if (!token) {
    throw new Error("Twitch is not connected for this instance");
  }

  const clientId = process.env.AUTH_TWITCH_ID;
  if (!clientId) {
    throw new Error("AUTH_TWITCH_ID env var is not set");
  }

  return { accessToken: token.accessToken, broadcasterUserId: token.broadcasterUserId, clientId };
}
