import { safeRelativePath } from "@convex/lib/safeRedirect";

/**
 * Where to go after signing in or registering, from a `?next=` value. Only a
 * path on this site is accepted, clamped by `safeRelativePath`: anything that
 * could name another site (`//host`, `/\host`, `https://…`) is refused along
 * with anything that is not a path. The next path survives an OAuth round
 * trip through Twitch sign-up, so a refusal here is what keeps it from
 * becoming an open redirect.
 */
export function safeNextPath(next: string | null, fallback: string): string {
  if (next === null) {
    return fallback;
  }
  const safe = safeRelativePath(next, "/");
  // safeRelativePath answers "/" for a value it refuses; only a literal "/" means the home page.
  if (safe === "/" && next !== "/") {
    return fallback;
  }
  return safe;
}

/** `safeNextPath` for the current page's `?next=`. */
export function nextPathFromLocation(fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  return safeNextPath(new URLSearchParams(window.location.search).get("next"), fallback);
}

/**
 * Where a new account goes after sign-up, by password or Twitch: onboarding,
 * unless it was created on the way somewhere else. An invitee goes back to
 * accept the invitation and a sponsor on to their sponsorship, neither through
 * onboarding to set up an engine of their own.
 */
export function afterRegisterPath(search: string): string {
  return safeNextPath(new URLSearchParams(search).get("next"), "/auth/onboarding");
}

/** A link to another auth page that carries this page's `?next=` along. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
