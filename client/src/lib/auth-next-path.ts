/**
 * Where to go after signing in or registering, from a `?next=` value. Only a
 * path on this site is accepted: `//host` is a URL to another site, so it is
 * refused along with anything that is not a path.
 */
export function safeNextPath(next: string | null, fallback: string): string {
  if (next?.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return fallback;
}

/** `safeNextPath` for the current page's `?next=`. */
export function nextPathFromLocation(fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  return safeNextPath(new URLSearchParams(window.location.search).get("next"), fallback);
}

/** A link to another auth page that carries this page's `?next=` along. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
