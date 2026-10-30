// Twitch users as Helix describes them, and the logins people type for them.
// Pure, so both the Convex actions and the direct gateway read a lookup the
// same way; the lookups themselves live with whoever makes the call.

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

export type TwitchChannelRole = "moderator" | "vip";

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
 * The user a Helix `/users` answer names: null when Twitch found nobody,
 * which is also its answer for a suspended or banned account.
 */
export async function readTwitchUserAnswer(response: Response): Promise<TwitchUser | null> {
  if (!response.ok) {
    throw new Error(`Twitch user lookup failed: ${response.status} ${await response.text()}`);
  }
  return twitchUserFromHelix(await response.json());
}
