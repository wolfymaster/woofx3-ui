/**
 * OAuth providers redirect back to Convex HTTP routes, so a callback URL is a
 * deployment's site URL plus the route's path.
 *
 * Providers accept only redirect URLs registered with them, and a preview
 * deployment's site URL changes on every push. Previews therefore set
 * `OAUTH_CALLBACK_BASE_URL` to the production site URL: the provider calls back
 * to production, which forwards the callback to the preview that started the
 * flow (see `oauthState.ts`). Without it, a deployment receives its own
 * callbacks.
 *
 * Each path is what `convex/http.ts` routes the callback on, and what must be
 * registered as a redirect URL with the provider.
 */
export const OAUTH_CALLBACK_PATHS = {
  twitch: "/api/auth/twitch/callback",
  /** Every module's own OAuth integrations (`moduleOAuth.ts`). */
  module: "/api/integrations/oauth/callback",
} as const;

export type OAuthCallbackProvider = keyof typeof OAUTH_CALLBACK_PATHS;

/** Where providers send this deployment's callbacks. */
export function oauthCallbackBaseUrl(): string | undefined {
  return process.env.OAUTH_CALLBACK_BASE_URL || process.env.CONVEX_SITE_URL;
}

export function oauthCallbackUrl(provider: OAuthCallbackProvider, baseUrl = oauthCallbackBaseUrl()): string {
  if (!baseUrl) {
    throw new Error("CONVEX_SITE_URL is not set");
  }
  return new URL(OAUTH_CALLBACK_PATHS[provider], baseUrl).toString();
}
