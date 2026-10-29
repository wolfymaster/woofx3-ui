/**
 * The platform calls viewer sign-in and role checks make, behind one interface
 * per platform. Callers look a client up by platform id and never branch on
 * which platform it is; Kick or YouTube join by adding an entry to
 * `VIEWER_PLATFORMS` (lib/viewerAuth.ts) and an implementation.
 *
 * Role checks run with the viewer's own token, so they need neither the
 * streamer's token nor their engine, and keep working while the engine is
 * offline.
 */
import { logger } from "../logger";
import { isRevokedRefreshResponse } from "./twitchRefresh";
import { twitchUserFromHelix } from "./twitchUsers";
import type { SubscriberTier, ViewerPlatform } from "./viewerAuth";

export type PlatformResult<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export interface ViewerTokenGrant {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  scopes: string[];
}

export interface ViewerProfile {
  platformUserId: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
}

export interface ViewerRoleFacts {
  follower: boolean;
  subscriberTier: SubscriberTier | null;
}

export interface ViewerPlatformClient {
  /** Where to send the browser to ask the viewer for consent. */
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string, now: number): Promise<PlatformResult<ViewerTokenGrant, "failed">>;
  fetchProfile(accessToken: string): Promise<PlatformResult<ViewerProfile, "failed">>;
  /** "revoked" means only a fresh sign-in can restore access. */
  refreshTokens(
    refreshToken: string,
    now: number
  ): Promise<PlatformResult<ViewerTokenGrant, "revoked" | "unavailable">>;
  /** "unauthorized" means the access token is no good and refreshing it may help. */
  checkRoles(
    accessToken: string,
    viewerPlatformUserId: string,
    broadcasterPlatformUserId: string
  ): Promise<PlatformResult<ViewerRoleFacts, "unauthorized" | "unavailable">>;
}

// ── Twitch ─────────────────────────────────────────────────────────────────

/** What a viewer grants: enough to answer "do they follow / subscribe", nothing more. */
export const VIEWER_TWITCH_SCOPES = ["user:read:follows", "user:read:subscriptions"] as const;

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";
const TWITCH_FOLLOWED_URL = "https://api.twitch.tv/helix/channels/followed";
const TWITCH_USER_SUBSCRIPTION_URL = "https://api.twitch.tv/helix/subscriptions/user";

/** Helix `tier` values; Prime subscriptions report as tier 1. */
const TWITCH_TIERS: Record<string, SubscriberTier> = { "1000": 1, "2000": 2, "3000": 3 };

/** The platform-neutral tier for a Helix `tier` value, or null when Twitch sent one this does not know. */
export function subscriberTierFromTwitch(tier: unknown): SubscriberTier | null {
  return typeof tier === "string" ? (TWITCH_TIERS[tier] ?? null) : null;
}

export interface TwitchAppCredentials {
  clientId: string;
  clientSecret: string;
}

export function twitchAppCredentialsFromEnv(): TwitchAppCredentials {
  const clientId = process.env.AUTH_TWITCH_ID;
  const clientSecret = process.env.AUTH_TWITCH_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_TWITCH_ID/AUTH_TWITCH_SECRET env vars are not set");
  }
  return { clientId, clientSecret };
}

/** A token endpoint body as a grant, or null when it lacks a field a viewer grant needs. */
export function twitchGrantFromTokenBody(body: unknown, now: number): ViewerTokenGrant | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const data = body as Record<string, unknown>;
  if (
    typeof data.access_token !== "string" ||
    data.access_token.length === 0 ||
    typeof data.refresh_token !== "string" ||
    data.refresh_token.length === 0 ||
    typeof data.expires_in !== "number"
  ) {
    return null;
  }
  const scopes = Array.isArray(data.scope)
    ? data.scope.filter((scope): scope is string => typeof scope === "string")
    : typeof data.scope === "string"
      ? data.scope.split(" ").filter((scope) => scope.length > 0)
      : [];
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + data.expires_in * 1000,
    scopes,
  };
}

export function twitchViewerClient(credentials: TwitchAppCredentials): ViewerPlatformClient {
  const helixHeaders = (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
    "Client-Id": credentials.clientId,
  });

  const tokenRequest = (params: Record<string, string>) =>
    fetch(TWITCH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        ...params,
      }),
    });

  return {
    authorizeUrl(state, redirectUri) {
      const params = new URLSearchParams({
        client_id: credentials.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: VIEWER_TWITCH_SCOPES.join(" "),
        state,
      });
      return `${TWITCH_AUTHORIZE_URL}?${params}`;
    },

    async exchangeCode(code, redirectUri, now) {
      const response = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
      if (!response.ok) {
        return { ok: false, error: "failed" };
      }
      const grant = twitchGrantFromTokenBody(await response.json(), now);
      return grant ? { ok: true, value: grant } : { ok: false, error: "failed" };
    },

    async fetchProfile(accessToken) {
      const response = await fetch(TWITCH_USERS_URL, { headers: helixHeaders(accessToken) });
      if (!response.ok) {
        return { ok: false, error: "failed" };
      }
      const user = twitchUserFromHelix(await response.json());
      if (!user) {
        return { ok: false, error: "failed" };
      }
      return {
        ok: true,
        value: {
          platformUserId: user.twitchUserId,
          login: user.login,
          displayName: user.displayName,
          avatarUrl: user.profileImageUrl,
        },
      };
    },

    async refreshTokens(refreshToken, now) {
      const response = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
      if (!response.ok) {
        const body = await response.text();
        return { ok: false, error: isRevokedRefreshResponse(response.status, body) ? "revoked" : "unavailable" };
      }
      const grant = twitchGrantFromTokenBody(await response.json(), now);
      return grant ? { ok: true, value: grant } : { ok: false, error: "unavailable" };
    },

    async checkRoles(accessToken, viewerPlatformUserId, broadcasterPlatformUserId) {
      const query = `user_id=${encodeURIComponent(viewerPlatformUserId)}&broadcaster_id=${encodeURIComponent(broadcasterPlatformUserId)}`;
      const [followResponse, subscriptionResponse] = await Promise.all([
        fetch(`${TWITCH_FOLLOWED_URL}?${query}`, { headers: helixHeaders(accessToken) }),
        fetch(`${TWITCH_USER_SUBSCRIPTION_URL}?${query}`, { headers: helixHeaders(accessToken) }),
      ]);
      if (followResponse.status === 401 || subscriptionResponse.status === 401) {
        return { ok: false, error: "unauthorized" };
      }
      if (!followResponse.ok) {
        return { ok: false, error: "unavailable" };
      }
      const followBody = (await followResponse.json()) as { data?: unknown };
      const follower = Array.isArray(followBody.data) && followBody.data.length > 0;

      // Helix answers "not subscribed" with 404 rather than an empty list.
      if (subscriptionResponse.status === 404) {
        return { ok: true, value: { follower, subscriberTier: null } };
      }
      if (!subscriptionResponse.ok) {
        return { ok: false, error: "unavailable" };
      }
      const subscriptionBody = (await subscriptionResponse.json()) as { data?: unknown };
      const subscription = Array.isArray(subscriptionBody.data)
        ? (subscriptionBody.data[0] as { tier?: unknown } | undefined)
        : undefined;
      if (subscription === undefined) {
        return { ok: true, value: { follower, subscriberTier: null } };
      }
      const tier = subscriberTierFromTwitch(subscription.tier);
      if (tier === null) {
        // Subscribed for certain, at a tier Twitch did not have when this was
        // written: the lowest tier is the claim that is never too generous.
        logger.warn("unknown Twitch subscription tier", { tier: String(subscription.tier) });
        return { ok: true, value: { follower, subscriberTier: 1 } };
      }
      return { ok: true, value: { follower, subscriberTier: tier } };
    },
  };
}

// ── Registry ───────────────────────────────────────────────────────────────

const VIEWER_PLATFORM_CLIENT_FACTORIES: Record<ViewerPlatform, () => ViewerPlatformClient> = {
  twitch: () => twitchViewerClient(twitchAppCredentialsFromEnv()),
};

/** The client for a platform, built from this deployment's app credentials. Throws when they are not configured. */
export function viewerPlatformClient(platform: ViewerPlatform): ViewerPlatformClient {
  const factory = VIEWER_PLATFORM_CLIENT_FACTORIES[platform];
  if (!factory) {
    throw new Error(`No viewer platform client for "${platform}"`);
  }
  return factory();
}
