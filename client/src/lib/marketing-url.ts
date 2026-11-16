/** Where the marketing site lives; a build serving it elsewhere (a preview) sets VITE_MARKETING_URL. */
export const DEFAULT_MARKETING_URL = "https://woofx3.tv";

/** The marketing site's origin, without a trailing slash. Throws on a configured value that is not an http(s) URL. */
export function marketingUrl(configured = import.meta.env.VITE_MARKETING_URL as string | undefined): string {
  const value = configured?.trim() ? configured.trim() : DEFAULT_MARKETING_URL;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`VITE_MARKETING_URL is not a URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`VITE_MARKETING_URL must be an http or https URL: ${value}`);
  }
  return value.replace(/\/+$/, "");
}
