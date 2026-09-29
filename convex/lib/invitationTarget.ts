// Who a team invitation is for, and whether a signed-in user is that person.
// An invitation names either an email address or a platform account; the two
// are mutually exclusive, and a row with both or neither is corrupt.

export type InvitationPlatform = "twitch";

export type InvitationTarget =
  | { kind: "email"; email: string }
  | { kind: "platform"; platform: InvitationPlatform; platformUserId: string };

/** The target fields as an `invitations` row stores them. */
export interface InvitationTargetFields {
  email?: string;
  platform?: InvitationPlatform;
  platformUserId?: string;
}

/** Who is signed in, as far as matching an invitation goes. */
export interface InviteeIdentity {
  /** Normalized email, or null when the user has none. */
  email: string | null;
  /** The Twitch user id of the user's `twitch` auth account, or null when they never signed in with Twitch. */
  twitchUserId: string | null;
}

/** Reads a row's target, throwing when it names both an email and a platform account, or neither. */
export function invitationTarget(row: InvitationTargetFields): InvitationTarget {
  const hasEmail = row.email !== undefined && row.email !== "";
  const hasPlatform = row.platform !== undefined || row.platformUserId !== undefined;
  if (hasEmail === hasPlatform) {
    throw new Error("Invitation must target exactly one of an email address or a platform account");
  }
  if (hasEmail) {
    return { kind: "email", email: row.email as string };
  }
  if (row.platform === undefined || row.platformUserId === undefined || row.platformUserId === "") {
    throw new Error("Invitation names a platform account without both a platform and a user id");
  }
  return { kind: "platform", platform: row.platform, platformUserId: row.platformUserId };
}

/**
 * Why the signed-in user may not accept an invitation, or null when they may.
 * A platform invite matches on the platform's user id, never the login: logins
 * can be renamed, and a released one can be claimed by someone else.
 */
export function acceptRefusal(target: InvitationTarget, invitee: InviteeIdentity): string | null {
  if (target.kind === "email") {
    if (invitee.email === null || invitee.email !== target.email) {
      return "Sign in with the email address this invitation was sent to";
    }
    return null;
  }
  if (invitee.twitchUserId === null || invitee.twitchUserId !== target.platformUserId) {
    return "Sign in with the Twitch account this invitation was sent to";
  }
  return null;
}
