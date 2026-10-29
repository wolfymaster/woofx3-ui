/**
 * Where the public page app serves production pages. A build serving pages
 * elsewhere (a preview, a local page app) sets VITE_USER_PAGE_BASE_URL.
 */
export const DEFAULT_USER_PAGE_BASE_URL = "https://woofx3.tv";

/**
 * The origin public user pages are served from. Read when called rather than
 * when imported, like convexSiteUrl. Throws on a configured value that is not
 * an http(s) URL, since every link built from it would be broken.
 */
export function userPageBaseUrl(configured = import.meta.env.VITE_USER_PAGE_BASE_URL as string | undefined): string {
  const value = configured?.trim() ? configured.trim() : DEFAULT_USER_PAGE_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`VITE_USER_PAGE_BASE_URL is not a URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`VITE_USER_PAGE_BASE_URL must be an http or https URL: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

/** The public address of the page published under `slug`. */
export function userPageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/u/${encodeURIComponent(slug)}`;
}
