/**
 * A URL from page content, if it uses one of `protocols`. Convex checks links
 * and images when a page is saved; the page checks again before putting one
 * in an `href` or `src`, so a stored value that slipped past cannot run
 * script (`javascript:`) or load insecure content on this origin.
 */
export function urlWithProtocol(url: string, protocols: readonly string[]): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return protocols.includes(parsed.protocol) ? parsed : null;
}

/** Where a visitor may be sent. */
export function linkUrl(url: string): string | null {
  return urlWithProtocol(url, ["http:", "https:"])?.href ?? null;
}

/** What the page may load as an image: https only, so it never mixes in insecure content. */
export function imageUrl(url: string): string | null {
  return urlWithProtocol(url, ["https:"])?.href ?? null;
}

/** A link's host as a visitor recognises it, without a leading `www.`. */
export function displayHost(url: string): string {
  const parsed = urlWithProtocol(url, ["http:", "https:"]);
  return parsed ? parsed.hostname.replace(/^www\./, "") : "";
}

/**
 * The dashboard's registration page. Absolute because the page is also
 * served on woofx3.tv, where every path outside `/u/` belongs to the
 * marketing site.
 */
export const REGISTER_URL = "https://stream.woofx3.tv/auth/register";
