import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { type ActionCtx, internalQuery } from "../_generated/server";
import { freshTwitchToken } from "../platformRealtime";
import { getInstanceMembership } from "./teamAccess";

// Shared authorization for Convex actions that call Twitch Helix on the
// broadcaster's behalf. One copy deliberately: the scope check below is the
// only thing that turns a silent 401 into something actionable, and a second
// copy is how that protection drifts out of sync.

export interface AuthorizedTwitchCall {
  accessToken: string;
  broadcasterUserId: string;
  clientId: string;
}

/** The broadcaster's Twitch login on this instance, or null when Twitch is not
 * connected. Internal: the link row also carries the access and refresh
 * tokens, which must never leave the backend. */
export const twitchLoginFor = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, args): Promise<string | null> => {
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(10);
    return links.find((link) => link.platform === "twitch")?.platformUsername ?? null;
  },
});

/**
 * Everything an authorization needs, read in one query: whether the caller is a
 * member (when there is a caller) and the instance's Twitch link. One query
 * rather than one per check because each runQuery from an action is a billed
 * function call, and widgets authorize on every refresh. Internal: the link
 * carries the access and refresh tokens.
 */
export const twitchAuthContext = internalQuery({
  args: { instanceId: v.id("instances"), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<{ isMember: boolean; link: Doc<"platformLinks"> | null }> => {
    const isMember = args.userId ? (await getInstanceMembership(ctx, args.instanceId, args.userId)) !== null : false;
    const links = await ctx.db
      .query("platformLinks")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId))
      .take(10);
    return { isMember, link: links.find((link) => link.platform === "twitch") ?? null };
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
  const link = await linkForCaller(ctx, instanceId);
  assertScope(link, requiredScope);
  return credentialsFromLink(ctx, link);
}

/**
 * `authorizeTwitch` for a Helix read that needs no scope at all, such as the
 * channel's title and category. Still member-only: the token is the
 * broadcaster's, whatever the endpoint asks of it.
 */
export async function authorizeTwitchUnscoped(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<AuthorizedTwitchCall> {
  return credentialsFromLink(ctx, await linkForCaller(ctx, instanceId));
}

export function missingTwitchScopeMessage(scope: string): string {
  return `Your Twitch connection is missing the "${scope}" permission. Reconnect Twitch in Settings → Integrations to grant it.`;
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
  const { link } = await ctx.runQuery(internal.lib.twitchAuth.twitchAuthContext, { instanceId });
  assertScope(link, requiredScope);
  return credentialsFromLink(ctx, link);
}

/**
 * A fresh token with no caller or scope check. Only for an action that has
 * already checked both itself, so several Helix calls can share one token.
 */
export async function freshTwitchCredentials(
  ctx: ActionCtx,
  instanceId: Id<"instances">
): Promise<AuthorizedTwitchCall> {
  const { link } = await ctx.runQuery(internal.lib.twitchAuth.twitchAuthContext, { instanceId });
  return credentialsFromLink(ctx, link);
}

async function linkForCaller(ctx: ActionCtx, instanceId: Id<"instances">): Promise<Doc<"platformLinks"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Not authenticated");
  }
  const { isMember, link } = await ctx.runQuery(internal.lib.twitchAuth.twitchAuthContext, { instanceId, userId });
  if (!isMember) {
    throw new Error("Not a member of this instance");
  }
  return link;
}

function assertScope(link: Doc<"platformLinks"> | null, requiredScope: string): void {
  if (!(link?.scopes ?? []).includes(requiredScope)) {
    throw new Error(missingTwitchScopeMessage(requiredScope));
  }
}

async function credentialsFromLink(ctx: ActionCtx, link: Doc<"platformLinks"> | null): Promise<AuthorizedTwitchCall> {
  if (!link) {
    throw new Error("Twitch is not connected for this instance");
  }

  const clientId = process.env.AUTH_TWITCH_ID;
  if (!clientId) {
    throw new Error("AUTH_TWITCH_ID env var is not set");
  }

  const token = await freshTwitchToken(ctx, link);
  return { accessToken: token.accessToken, broadcasterUserId: token.broadcasterUserId, clientId };
}
