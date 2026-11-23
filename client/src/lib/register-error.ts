import type { SignUpChallengeErrorCode } from "@convex/lib/signUpChallenge";
import { ConvexError } from "convex/values";

export const PASSWORD_MIN_LENGTH = 8;

export type RegisterErrorKind = "password" | "challenge" | "exists-or-unknown";

const CHALLENGE_MESSAGES: Record<SignUpChallengeErrorCode, string> = {
  sign_up_challenge_failed: "Complete the check that confirms you're a person, then try again.",
  sign_up_challenge_unavailable: "We couldn't confirm you're a person just now. Try again in a moment.",
};

function challengeMessage(err: unknown): string | null {
  if (!(err instanceof ConvexError) || typeof err.data?.code !== "string") {
    return null;
  }
  return Object.hasOwn(CHALLENGE_MESSAGES, err.data.code)
    ? CHALLENGE_MESSAGES[err.data.code as SignUpChallengeErrorCode]
    : null;
}

export interface RegisterError {
  kind: RegisterErrorKind;
  message: string;
}

/**
 * Maps a failed password sign-up to friendly copy. Production Convex redacts
 * server errors to a bare "Server Error", so an existing account cannot be told
 * apart from other failures there; every non-password failure therefore points
 * at signing in. A failed bot check is a ConvexError, which production does
 * not redact, so it gets its own copy.
 */
export function registerError(err: unknown): RegisterError {
  const challenge = challengeMessage(err);
  if (challenge !== null) {
    return { kind: "challenge", message: challenge };
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (/invalid password/i.test(raw)) {
    return { kind: "password", message: `Use a password with at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  return {
    kind: "exists-or-unknown",
    message: "We couldn't create your account. If you already signed up with this email, sign in instead.",
  };
}
