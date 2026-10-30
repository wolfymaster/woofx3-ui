// Helix user lookups shared by every Convex function that turns a Twitch login
// or id into a person: the shoutout confirmation and team invites. Only the
// Helix call lives here; which token it runs with, and who may ask, is the
// caller's decision.

import { readTwitchUserAnswer, type TwitchChannelRole, type TwitchUser } from "@shared/twitch-users";
import { helixResponse, type TwitchHelixRoute } from "./twitchEngineHelix";

const TWITCH_USERS_URL = "https://api.twitch.tv/helix/users";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

export interface HelixCredentials {
  accessToken: string;
  clientId: string;
}

/**
 * One Twitch user by login or by id. Null when no such user exists, which is
 * also what Helix answers for a suspended or banned account.
 *
 * `route` may send the lookup through the engine, which looks users up with
 * the broadcaster's link token; pass it only when `credentials` are that
 * token, so both paths ask Twitch as the same user.
 */
export async function fetchTwitchUser(
  credentials: HelixCredentials,
  by: { login: string } | { id: string },
  route?: TwitchHelixRoute
): Promise<TwitchUser | null> {
  const query = "login" in by ? `login=${encodeURIComponent(by.login)}` : `id=${encodeURIComponent(by.id)}`;
  const direct = () =>
    fetch(`${TWITCH_USERS_URL}?${query}`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Client-Id": credentials.clientId },
    });
  const response = route
    ? await helixResponse(route, {
        operation: "getUsers",
        kind: "read",
        viaEngine: (engine) => engine.twitchGetUsers("login" in by ? { login: by.login } : { id: by.id }),
        direct,
      })
    : await direct();
  return readTwitchUserAnswer(response);
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

const CHANNEL_ROLE_URLS: Record<TwitchChannelRole, string> = {
  moderator: "https://api.twitch.tv/helix/moderation/moderators",
  vip: "https://api.twitch.tv/helix/channels/vips",
};

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
