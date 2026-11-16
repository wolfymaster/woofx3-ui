import { ConvexError } from "convex/values";
import { isPreviewDeployment } from "./previewDeployment";
import { TURNSTILE_SECRET_ENV, turnstileSecret, verifyTurnstile } from "./turnstile";

type Env = Record<string, string | undefined>;

/**
 * Cloudflare's published Turnstile test secret that accepts every token
 * (developers.cloudflare.com/turnstile/troubleshooting/testing). A preview uses
 * it whatever else is set: the cloud browsers that test previews cannot solve a
 * real challenge, and they get the matching always-pass site key at build time.
 */
export const TURNSTILE_ALWAYS_PASSES_SECRET = "1x0000000000000000000000000000000AA";

/** The `code` of the ConvexError a refused sign-up throws, read by the register page. */
export type SignUpChallengeErrorCode = "sign_up_challenge_failed" | "sign_up_challenge_unavailable";

/**
 * The secret password sign-up is checked with. A deployment without one throws
 * rather than letting sign-ups through unchecked; a local deployment sets
 * `TURNSTILE_SECRET_KEY` to the always-pass test secret.
 */
export function signUpTurnstileSecret(env: Env): string {
  if (isPreviewDeployment(env)) {
    return TURNSTILE_ALWAYS_PASSES_SECRET;
  }
  const secret = turnstileSecret(env);
  if (secret === null) {
    throw new Error(`${TURNSTILE_SECRET_ENV} is not set, so password sign-up cannot be checked and is refused`);
  }
  return secret;
}

/** Throws unless the Turnstile token a password sign-up carries passes. */
export async function requireSignUpChallenge(token: unknown, env: Env = process.env): Promise<void> {
  const verdict = await verifyTurnstile(signUpTurnstileSecret(env), typeof token === "string" ? token : null);
  if (verdict === "passed") {
    return;
  }
  const code: SignUpChallengeErrorCode =
    verdict === "refused" ? "sign_up_challenge_failed" : "sign_up_challenge_unavailable";
  throw new ConvexError({ code });
}
