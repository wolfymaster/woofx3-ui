import { generateOpaqueToken } from "@convex/lib/oauthHandoff";
import { CONVEX_SITE_URL } from "@/lib/convexSiteUrl";

/**
 * Twitch sign-in binds the round trip to the tab that started it: a random
 * nonce is kept in this tab's sessionStorage and its hash in the OAuth state.
 * The callback page presents the nonce with the one-time sign-in token, and
 * Convex signs in only when the two match, so a callback link captured from
 * someone else's sign-in cannot sign this browser in as them.
 *
 * sessionStorage rather than a cookie: the nonce has to be readable by the
 * SPA, which lives on a different origin from the Convex site that runs the
 * OAuth routes, and sessionStorage is scoped to the one tab doing the sign-in.
 */
const NONCE_KEY = "woofx3.twitchSignInNonce";

/** Shown when `startTwitchSignIn` throws because this site may not use sessionStorage. */
export const TWITCH_SIGN_IN_STORAGE_ERROR =
  "Twitch sign-in needs browser storage for this site. Allow it and try again.";

/** Throws when the nonce cannot be stored; callers show `TWITCH_SIGN_IN_STORAGE_ERROR`. */
export function startTwitchSignIn(redirectTo: string): void {
  const nonce = generateOpaqueToken();
  window.sessionStorage.setItem(NONCE_KEY, nonce);
  const params = new URLSearchParams({ redirect_to: redirectTo, nonce });
  window.location.href = `${CONVEX_SITE_URL}/api/auth/twitch/start?${params}`;
}

/** The nonce this tab started a sign-in with, or null. Removed as it is read: it is good for one sign-in. */
export function takeTwitchSignInNonce(): string | null {
  try {
    const nonce = window.sessionStorage.getItem(NONCE_KEY);
    window.sessionStorage.removeItem(NONCE_KEY);
    return nonce;
  } catch {
    return null;
  }
}
