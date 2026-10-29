/**
 * How a role refresh decides what to ask the platform, kept apart from the
 * Convex action that persists the outcome so the decision can be tested with
 * only the platform's HTTP faked.
 */
import { type ViewerRoles, viewerRolesFresh } from "./viewerAuth";
import type { ViewerPlatformClient, ViewerRoleFacts, ViewerTokenGrant } from "./viewerPlatforms";

/** Refresh an access token this close to expiring before using it. */
export const VIEWER_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface RoleRefreshInput {
  client: ViewerPlatformClient;
  now: number;
  cached: ViewerRoles | null;
  /** The viewer's opened grant, or null when they must sign in again. */
  grant: ViewerTokenGrant | null;
  viewerPlatformUserId: string;
  broadcasterPlatformUserId: string;
}

export type RoleRefreshOutcome =
  | { kind: "cached"; roles: ViewerRoles }
  /** `refreshedGrant` is set when the access token was renewed on the way and must be stored. */
  | { kind: "checked"; roles: ViewerRoleFacts; refreshedGrant: ViewerTokenGrant | null }
  /** The platform refused the refresh token; the viewer must sign in again. */
  | { kind: "reauth_required"; revoked: boolean }
  | { kind: "unavailable"; refreshedGrant: ViewerTokenGrant | null };

export async function refreshViewerRoles(input: RoleRefreshInput): Promise<RoleRefreshOutcome> {
  const { client, now, cached, grant } = input;
  if (cached !== null && viewerRolesFresh(cached, now)) {
    return { kind: "cached", roles: cached };
  }
  if (grant === null) {
    return { kind: "reauth_required", revoked: false };
  }

  let current = grant;
  let refreshedGrant: ViewerTokenGrant | null = null;
  const renew = async (): Promise<RoleRefreshOutcome | null> => {
    const renewed = await client.refreshTokens(current.refreshToken, now);
    if (!renewed.ok) {
      return renewed.error === "revoked"
        ? { kind: "reauth_required", revoked: true }
        : { kind: "unavailable", refreshedGrant };
    }
    current = renewed.value;
    refreshedGrant = renewed.value;
    return null;
  };

  if (current.expiresAt - now <= VIEWER_TOKEN_REFRESH_MARGIN_MS) {
    const stopped = await renew();
    if (stopped) {
      return stopped;
    }
  }

  let check = await client.checkRoles(current.accessToken, input.viewerPlatformUserId, input.broadcasterPlatformUserId);
  // A token can be revoked before it expires; one renewal is worth a try.
  if (!check.ok && check.error === "unauthorized" && refreshedGrant === null) {
    const stopped = await renew();
    if (stopped) {
      return stopped;
    }
    check = await client.checkRoles(current.accessToken, input.viewerPlatformUserId, input.broadcasterPlatformUserId);
  }
  if (!check.ok) {
    return check.error === "unauthorized"
      ? { kind: "reauth_required", revoked: false }
      : { kind: "unavailable", refreshedGrant };
  }
  return { kind: "checked", roles: check.value, refreshedGrant };
}
