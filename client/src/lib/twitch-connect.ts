/**
 * The Convex HTTP route that starts Twitch's integration OAuth flow for an
 * instance and, once Twitch answers, sends the browser back to `redirectTo`.
 * Connecting again over an existing link replaces it, which is how a link
 * picks up newly requested scopes or recovers from a revoked token.
 */
export function twitchConnectUrl(siteUrl: string, instanceId: string, redirectTo: string): string {
  if (!siteUrl || !instanceId) {
    throw new Error("twitchConnectUrl needs a site URL and an instance id");
  }
  const params = new URLSearchParams({ instanceId, redirect_to: redirectTo });
  return `${siteUrl}/api/integrations/twitch/start?${params.toString()}`;
}
