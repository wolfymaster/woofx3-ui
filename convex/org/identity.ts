import type { Doc } from "../_generated/dataModel";

/**
 * Whether the user has proven they control their email address. Convex Auth
 * sets `emailVerificationTime` only when a verification completes, so a user
 * who has never verified (every account that predates verification, and
 * Twitch sign-ins) is unverified. Anything that treats an email as proof of
 * identity, such as accepting an email invitation or paying a referral reward,
 * goes through this check.
 */
export function isEmailVerified(user: Pick<Doc<"users">, "emailVerificationTime">): boolean {
  return user.emailVerificationTime !== undefined;
}
