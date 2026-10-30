import type { PublicPageLookup } from "@shared/user-pages";
import { useRef } from "react";

/** What a page read was asked for: the slug and the session it was read as. */
export interface LookupKey {
  slug: string;
  sessionToken: string | null;
}

/**
 * Whether the answer read for `previous` may stay on screen while the read
 * for `next` loads. Only for the same slug, and never one read for a session
 * the viewer no longer holds: an anonymous answer may stand in once they
 * sign in (it shows less than they will see), but a signed-in answer never
 * stands in after they sign out or for another viewer.
 */
export function mayStandIn(previous: LookupKey, next: LookupKey): boolean {
  if (previous.slug !== next.slug) {
    return false;
  }
  return previous.sessionToken === null || previous.sessionToken === next.sessionToken;
}

/**
 * `lookup`, or while it loads the last answer read for a key that may stand
 * in for `key`, so signing in does not drop the page back to its skeleton.
 * The ref is written during render because the value is derived from props;
 * a render React discards would only have stored an answer that was already
 * correct for its key.
 */
export function useLookupWhileLoading(
  key: LookupKey,
  lookup: PublicPageLookup | undefined
): PublicPageLookup | undefined {
  const last = useRef<{ key: LookupKey; lookup: PublicPageLookup } | null>(null);
  if (lookup !== undefined) {
    last.current = { key, lookup };
    return lookup;
  }
  const previous = last.current;
  return previous !== null && mayStandIn(previous.key, key) ? previous.lookup : undefined;
}
