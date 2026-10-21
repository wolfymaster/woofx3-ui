/**
 * The Convex deployment's HTTP origin (`*.convex.site`): VITE_CONVEX_SITE_URL,
 * or VITE_CONVEX_URL with its `.convex.cloud` host swapped for `.convex.site`.
 * Read when called rather than when imported, so a module that only builds
 * these URLs on demand loads without the build's environment. Throws when
 * neither variable is set, since every URL built from it would be wrong.
 */
export function convexSiteUrl(): string {
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
  if (siteUrl) {
    return siteUrl;
  }
  const cloudUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!cloudUrl) {
    throw new Error("VITE_CONVEX_URL is not set, so the Convex site URL is unknown");
  }
  return cloudUrl.replace(/\.convex\.cloud$/, ".convex.site");
}
