import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { hashOpaqueToken, isOpaqueToken } from "./oauthHandoff";
import { isViewerPlatform, type ViewerPlatform, type ViewerRoles } from "./viewerAuth";

/**
 * Authentication for page functions a viewer calls with their session token.
 * The viewerSessions row is the credential: a token whose hash has no row is
 * not signed in, and every helper fails closed.
 *
 * These never consult Convex Auth, and Convex Auth never consults them, so a
 * viewer session cannot satisfy `getAuthUserId` or `requireInstanceRole`, and
 * a dashboard session cannot stand in for a viewer.
 *
 * A session row exists only while it is live (viewerSession.ts deletes it on
 * sign-out and at `expiresAt`), so a query needs no clock to refuse an
 * expired session.
 */

/** The live session a token names, or null. */
export async function viewerSessionByToken(ctx: QueryCtx, sessionToken: string): Promise<Doc<"viewerSessions"> | null> {
  if (!isOpaqueToken(sessionToken)) {
    return null;
  }
  const tokenHash = await hashOpaqueToken(sessionToken);
  return ctx.db
    .query("viewerSessions")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
}

/** The viewer a session token signs in, or null for an anonymous visitor. */
export async function viewerFromSession(ctx: QueryCtx, sessionToken: string | null): Promise<Doc<"viewers"> | null> {
  if (sessionToken === null) {
    return null;
  }
  const session = await viewerSessionByToken(ctx, sessionToken);
  if (!session) {
    return null;
  }
  const viewer = await ctx.db.get(session.viewerId);
  if (!viewer) {
    throw new Error(`viewer session ${session._id} names a viewer that does not exist`);
  }
  return viewer;
}

/** `viewerFromSession` for functions that act only for a signed-in viewer. */
export async function requireViewer(ctx: QueryCtx, sessionToken: string): Promise<Doc<"viewers">> {
  const viewer = await viewerFromSession(ctx, sessionToken);
  if (!viewer) {
    throw new ConvexError("Not signed in");
  }
  return viewer;
}

/**
 * The viewer's cached roles on a broadcaster's channel, or null when they
 * were never checked or the check has expired. A row is deleted
 * VIEWER_ROLES_TTL_MS after its check (viewerRoles.ts), so what this returns
 * is fresh without the query reading a clock; a page asks
 * `viewerRoles.refresh` when it gets null.
 */
export async function viewerRolesFor(
  ctx: QueryCtx,
  viewerId: Id<"viewers">,
  broadcasterPlatformUserId: string
): Promise<ViewerRoles | null> {
  const viewer = await ctx.db.get(viewerId);
  if (!viewer) {
    return null;
  }
  const row = await ctx.db
    .query("viewerRoles")
    .withIndex("by_viewer_and_platform_and_broadcaster", (q) =>
      q
        .eq("viewerId", viewerId)
        .eq("platform", viewer.platform)
        .eq("broadcasterPlatformUserId", broadcasterPlatformUserId)
    )
    .unique();
  if (!row) {
    return null;
  }
  return { follower: row.follower, subscriberTier: row.subscriberTier, checkedAt: row.checkedAt };
}

export interface Broadcaster {
  platform: ViewerPlatform;
  platformUserId: string;
}

/** The channel an instance streams on, from its platform link, or null when none is linked. */
export async function broadcasterForInstance(ctx: QueryCtx, instanceId: Id<"instances">): Promise<Broadcaster | null> {
  const links = await ctx.db
    .query("platformLinks")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .take(10);
  for (const link of links) {
    if (isViewerPlatform(link.platform)) {
      return { platform: link.platform, platformUserId: link.platformUserId };
    }
  }
  return null;
}
