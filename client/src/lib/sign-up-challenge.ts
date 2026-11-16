import { turnstileSiteKey } from "@/user-page/viewer/config";

/**
 * Cloudflare's published Turnstile test site key whose challenge always passes
 * (developers.cloudflare.com/turnstile/troubleshooting/testing). It pairs with
 * the always-pass test secret in `convex/lib/signUpChallenge.ts`.
 */
export const TURNSTILE_ALWAYS_PASSES_SITE_KEY = "1x00000000000000000000AA";

/**
 * The site key for the password sign-up's challenge, from
 * `VITE_TURNSTILE_SITE_KEY`. A development build without one uses the test key;
 * a production build without one throws, because Convex refuses every password
 * sign-up that carries no token.
 */
export function signUpSiteKey(configured: unknown, isDevelopmentBuild: boolean): string {
  const key = turnstileSiteKey(configured);
  if (key !== null) {
    return key;
  }
  if (isDevelopmentBuild) {
    return TURNSTILE_ALWAYS_PASSES_SITE_KEY;
  }
  throw new Error("VITE_TURNSTILE_SITE_KEY is not set, and password sign-up needs it");
}
