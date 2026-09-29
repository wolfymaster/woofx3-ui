import { TWITCH_INTEGRATION_SCOPES } from "./twitchIntegrationScopes";

/**
 * Whether an instance's Twitch link can still do everything the app asks of it.
 *
 * A link keeps the scopes Twitch granted when it was made. Adding a scope to
 * TWITCH_INTEGRATION_SCOPES does not reach links made before, and a token
 * revoked on Twitch's side keeps its row here; both show up only as a 401 on
 * whichever call needs them. This names the gap up front, in the creator's
 * words rather than Twitch's scope strings.
 *
 * Shared by the shell banner and the integrations page, so it stays free of
 * Convex server imports.
 */

export interface TwitchCapability {
  /** What the creator loses without it, as the banner lists it. */
  label: string;
  scopes: readonly string[];
  /**
   * A capability few creators use. Its absence is listed on the integrations
   * page but never raises the shell banner, which would otherwise nag every
   * member of every instance linked before the scope was requested.
   */
  optional?: boolean;
}

/**
 * Every scope in TWITCH_INTEGRATION_SCOPES belongs to exactly one capability;
 * twitchScopeHealth.test.ts holds that invariant so a new scope cannot be
 * requested without the banner being able to name it.
 */
export const TWITCH_CAPABILITIES: readonly TwitchCapability[] = [
  { label: "Profile", scopes: ["user:read:email"] },
  {
    label: "Chat bot",
    scopes: ["user:bot", "user:write:chat", "user:read:chat", "chat:read", "chat:edit"],
  },
  {
    label: "Stream event alerts",
    scopes: ["bits:read", "channel:read:hype_train", "channel:read:redemptions", "channel:read:subscriptions"],
  },
  { label: "Stream title and category", scopes: ["channel:manage:broadcast"] },
  { label: "Clips", scopes: ["clips:edit"] },
  { label: "Polls and predictions", scopes: ["channel:read:polls", "channel:read:predictions"] },
  {
    label: "Moderation",
    scopes: [
      "channel:moderate",
      "moderator:manage:banned_users",
      "moderator:manage:blocked_terms",
      "moderator:read:chat_settings",
      "moderator:read:unban_requests",
      "moderator:read:warnings",
    ],
  },
  // Changing chat modes (follower-only, subscriber-only, emote-only, slow).
  // The Moderation capability's read scope already shows the current modes.
  { label: "Moderation: chat modes", scopes: ["moderator:manage:chat_settings"], optional: true },
  { label: "Announcements and shoutouts", scopes: ["moderator:manage:announcements", "moderator:manage:shoutouts"] },
  { label: "Pinned messages", scopes: ["moderator:manage:chat_messages", "moderator:read:chat_messages"] },
  {
    label: "Viewer lists",
    scopes: ["moderator:read:chatters", "moderator:read:followers", "moderator:read:moderators", "moderator:read:vips"],
  },
];

export interface MissingTwitchCapability {
  label: string;
  optional: boolean;
  /** The scopes of this capability the link lacks, in TWITCH_CAPABILITIES order. */
  missingScopes: string[];
}

/**
 * `missing` holds only required capabilities, so it alone decides whether a
 * reconnect is needed; `optionalMissing` is informational.
 */
export type TwitchScopeHealth =
  | { state: "unlinked" }
  | { state: "revoked" }
  | { state: "missing"; missing: MissingTwitchCapability[]; optionalMissing: MissingTwitchCapability[] }
  | { state: "ok"; optionalMissing: MissingTwitchCapability[] };

/** The fields of a `platformLinks` row this reads; tokens are never needed. */
export interface TwitchLinkScopes {
  scopes: readonly string[];
  /** Set when Twitch refused the link's refresh token; cleared by a relink. */
  authFailedAt?: number;
}

/** Capabilities, required and optional, with at least one requested scope absent from `granted`. */
export function missingTwitchCapabilities(
  granted: readonly string[],
  required: readonly string[] = TWITCH_INTEGRATION_SCOPES
): MissingTwitchCapability[] {
  const have = new Set(granted);
  const needed = new Set(required);
  const missing: MissingTwitchCapability[] = [];
  for (const capability of TWITCH_CAPABILITIES) {
    const missingScopes = capability.scopes.filter((scope) => needed.has(scope) && !have.has(scope));
    if (missingScopes.length > 0) {
      missing.push({ label: capability.label, optional: capability.optional === true, missingScopes });
    }
  }
  return missing;
}

/**
 * Scopes of required capabilities absent from `granted`, in TWITCH_CAPABILITIES
 * order. An optional capability's scopes are left out, so a link that lacks
 * only those is not reported as needing a reconnect.
 */
export function missingRequiredTwitchScopes(granted: readonly string[]): string[] {
  return missingTwitchCapabilities(granted)
    .filter((capability) => !capability.optional)
    .flatMap((capability) => capability.missingScopes);
}

export function twitchScopeHealth(link: TwitchLinkScopes | null | undefined): TwitchScopeHealth {
  if (!link) {
    return { state: "unlinked" };
  }
  // Checked before scopes: a revoked token can do nothing, whatever it was granted.
  if (link.authFailedAt !== undefined) {
    return { state: "revoked" };
  }
  const all = missingTwitchCapabilities(link.scopes);
  const missing = all.filter((capability) => !capability.optional);
  const optionalMissing = all.filter((capability) => capability.optional);
  if (missing.length > 0) {
    return { state: "missing", missing, optionalMissing };
  }
  return { state: "ok", optionalMissing };
}

/**
 * A stable key for what the health reports, so a banner dismissed for one gap
 * comes back when the gap changes rather than staying hidden for the session.
 */
export function twitchScopeHealthKey(health: TwitchScopeHealth): string {
  if (health.state === "missing") {
    return `missing:${health.missing.flatMap((capability) => capability.missingScopes).join(",")}`;
  }
  return health.state;
}
