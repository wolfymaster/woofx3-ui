// Helix user lookups shared by every Convex function that turns a Twitch login
// or id into a person: the shoutout confirmation and team invites. Only the
// Helix call lives here; which token it runs with, and who may ask, is the
// caller's decision.

import { ConvexError } from "convex/values";

const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

/** Twitch logins are ASCII letters, digits and underscores, at most 25 long. */
const TWITCH_LOGIN = /^[a-z0-9_]{1,25}$/;

export interface TwitchUser {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  /** `partner`, `affiliate`, or empty for neither. */
  broadcasterType?: string;
}

export interface HelixCredentials {
  accessToken: string;
  clientId: string;
}

/**
 * A login as a person types it (`@SomeOne`), as Helix takes it (`someone`).
 * Null when what is left cannot be a login, so a lookup never sends Twitch a
 * query it would reject.
 */
export function normalizeTwitchLogin(input: string): string | null {
  const login = input.trim().replace(/^@/, "").toLowerCase();
  return TWITCH_LOGIN.test(login) ? login : null;
}

/** The first user in a Helix `/users` response, or null when Twitch found nobody. */
export function twitchUserFromHelix(body: unknown): TwitchUser | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const user = data[0] as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.login !== "string") {
    return null;
  }
  return {
    twitchUserId: user.id,
    login: user.login,
    displayName: typeof user.display_name === "string" && user.display_name !== "" ? user.display_name : user.login,
    profileImageUrl:
      typeof user.profile_image_url === "string" && user.profile_image_url !== "" ? user.profile_image_url : undefined,
    broadcasterType: typeof user.broadcaster_type === "string" ? user.broadcaster_type : undefined,
  };
}

/**
 * One Twitch user by login or by id. Null when no such user exists, which is
 * also what Helix answers for a suspended or banned account.
 */
export async function fetchTwitchUser(
  credentials: HelixCredentials,
  by: { login: string } | { id: string }
): Promise<TwitchUser | null> {
  const query = "login" in by ? `login=${encodeURIComponent(by.login)}` : `id=${encodeURIComponent(by.id)}`;
  const response = await fetch(`${TWITCH_USERS_URL}?${query}`, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-Id": credentials.clientId },
  });
  if (!response.ok) {
    throw new ConvexError(`Twitch user lookup failed: ${response.status} ${await response.text()}`);
  }
  return twitchUserFromHelix(await response.json());
}

/**
 * An app access token (client credentials), for lookups that need no user's
 * permission: `/helix/users` accepts one, so an account whose channel is not
 * linked yet can still look people up.
 */
export async function fetchTwitchAppCredentials(): Promise<HelixCredentials> {
  const clientId = process.env.AUTH_TWITCH_ID;
  const clientSecret = process.env.AUTH_TWITCH_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("AUTH_TWITCH_ID/AUTH_TWITCH_SECRET env vars are not set");
  }
  const response = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) {
    throw new Error(`Twitch app token request failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as { access_token: string };
  return { accessToken: data.access_token, clientId };
}

const CHANNEL_ROLE_URLS = {
  moderator: "https://api.twitch.tv/helix/moderation/moderators",
  vip: "https://api.twitch.tv/helix/channels/vips",
} as const;

export type TwitchChannelRole = keyof typeof CHANNEL_ROLE_URLS;

/**
 * Scopes any one of which lets a broadcaster token read each role list. Helix
 * accepts the broadcaster's own read or manage scope, or the moderator read
 * scope woofx3's integration link asks for.
 */
export const CHANNEL_ROLE_SCOPES: Record<TwitchChannelRole, readonly string[]> = {
  moderator: ["moderation:read", "channel:manage:moderators", "moderator:read:moderators"],
  vip: ["channel:read:vips", "channel:manage:vips", "moderator:read:vips"],
};

/** Whether granted scopes let a token read a channel's list of the given role. */
export function canReadChannelRole(role: TwitchChannelRole, scopes: readonly string[]): boolean {
  return CHANNEL_ROLE_SCOPES[role].some((scope) => scopes.includes(scope));
}

/**
 * Whether a user holds a role on a broadcaster's channel. Undefined when
 * Twitch would not say, so a caller shows nothing rather than a wrong "no".
 */
export async function fetchHasChannelRole(
  credentials: HelixCredentials,
  role: TwitchChannelRole,
  broadcasterUserId: string,
  userId: string
): Promise<boolean | undefined> {
  const url = `${CHANNEL_ROLE_URLS[role]}?broadcaster_id=${encodeURIComponent(broadcasterUserId)}&user_id=${encodeURIComponent(userId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-Id": credentials.clientId },
  });
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as { data?: unknown[] };
  return Array.isArray(body.data) && body.data.length > 0;
}
