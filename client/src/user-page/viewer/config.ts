/**
 * The public origin of user pages in production. It must match Convex's
 * USER_PAGES_BASE_URL: a sign-in may return only to that origin, and the
 * sign-in start route lives on its edge.
 */
export const DEFAULT_USER_PAGES_ORIGIN = "https://woofx3.tv";

/**
 * The user-pages origin from `VITE_USER_PAGES_BASE_URL`, or the production
 * origin when it is not set. A value that is set must be an https URL (or
 * http on localhost, for development); a blank or malformed one fails the
 * page at startup rather than standing in for the real origin.
 */
export function userPagesOrigin(configured: unknown): string {
  if (configured === undefined) {
    return DEFAULT_USER_PAGES_ORIGIN;
  }
  if (typeof configured !== "string" || configured.trim() === "") {
    throw new Error("VITE_USER_PAGES_BASE_URL is set but empty");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`VITE_USER_PAGES_BASE_URL is not a URL: ${configured}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error(`VITE_USER_PAGES_BASE_URL must be https (or http://localhost), got ${url.origin}`);
  }
  return url.origin;
}

/**
 * The Turnstile site key from `VITE_TURNSTILE_SITE_KEY`, or null when the page
 * was built without one, which closes forms to anonymous visitors and leaves
 * the rest of the page working. Blank counts as unset because an unset build
 * argument reaches Vite as an empty string; a value that cannot be a site key
 * fails the page at startup.
 */
export function turnstileSiteKey(configured: unknown): string | null {
  if (configured === undefined || configured === "") {
    return null;
  }
  if (typeof configured !== "string" || !/^[0-9A-Za-z_-]+$/.test(configured)) {
    throw new Error(`VITE_TURNSTILE_SITE_KEY is not a site key: ${String(configured)}`);
  }
  return configured;
}
