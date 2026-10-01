/**
 * OAuth providers redirect back to Convex HTTP routes, so a callback URL is
 * the deployment's own site URL plus the route's path. Deriving it, rather than
 * configuring one per provider, keeps it right on deployments whose site URL is
 * not known ahead of time, such as a pull request's preview deployment.
 *
 * Each path is what `convex/http.ts` routes the callback on, and what must be
 * registered as a redirect URL with the provider.
 */
export const OAUTH_CALLBACK_PATHS = {
  twitch: "/api/auth/twitch/callback",
  spotify: "/api/integrations/spotify/callback",
} as const;

export type OAuthCallbackProvider = keyof typeof OAUTH_CALLBACK_PATHS;

export function oauthCallbackUrl(provider: OAuthCallbackProvider, siteUrl = process.env.CONVEX_SITE_URL): string {
  if (!siteUrl) {
    throw new Error("CONVEX_SITE_URL is not set");
  }
  return new URL(OAUTH_CALLBACK_PATHS[provider], siteUrl).toString();
}
