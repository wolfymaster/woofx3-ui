import { safeRelativePath } from "@convex/lib/safeRedirect";

/**
 * The `next` page that AuthGuard put on the sign-in URL, carried through
 * sign-in and registration. Only a path on this site is returned, so the
 * parameter cannot become an open redirect.
 */
export function getNextPath(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) {
    return null;
  }
  const safe = safeRelativePath(next, "/");
  return safe === "/" ? null : safe;
}

/** `path` with the current `next` carried over, for links between the sign-in and register pages. */
export function withNextPath(path: string): string {
  const next = getNextPath();
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
