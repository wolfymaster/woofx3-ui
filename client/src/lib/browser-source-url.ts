import { CONVEX_SITE_URL } from "@/lib/convexSiteUrl";

/**
 * The public URL for a browser-source key — what OBS is pointed at, and what the
 * canvas preview embeds. One builder so the URL a user copies and the URL the
 * editor previews can never be assembled differently.
 */
export function browserSourceUrlForKey(key: string): string {
  return `${CONVEX_SITE_URL.replace(/\/+$/, "")}/browser-source/${key}`;
}
