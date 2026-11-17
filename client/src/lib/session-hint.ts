import { marketingUrl } from "./marketing-url";

/** The cookie the marketing site reads to tell a signed-in visitor; must match SESSION_HINT_COOKIE in woofx3-marketing `client/src/lib/session-hint.ts`. */
export const SESSION_HINT_COOKIE = "woofx3_session";

/** Matches the lifetime of a sign-in; the cookie is renewed on every load while signed in. */
const SESSION_HINT_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The cookie string that tells the marketing site whether this browser is signed in, or null when this host
 * cannot share a cookie with it (a preview, a local server). It is only a hint to choose which button to show:
 * it carries no token and grants nothing.
 */
export function sessionHintCookie(hostname: string, marketingHost: string, signedIn: boolean): string | null {
  if (hostname !== marketingHost && !hostname.endsWith(`.${marketingHost}`)) {
    return null;
  }
  const attributes = `domain=.${marketingHost}; path=/; SameSite=Lax; Secure`;
  return signedIn
    ? `${SESSION_HINT_COOKIE}=1; max-age=${SESSION_HINT_MAX_AGE_SECONDS}; ${attributes}`
    : `${SESSION_HINT_COOKIE}=; max-age=0; ${attributes}`;
}

/** Writes the hint for the current page's host. */
export function writeSessionHint(signedIn: boolean): void {
  const cookie = sessionHintCookie(window.location.hostname, new URL(marketingUrl()).hostname, signedIn);
  if (cookie !== null) {
    document.cookie = cookie;
  }
}
