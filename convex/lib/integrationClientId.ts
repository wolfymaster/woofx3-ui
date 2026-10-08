import type { ModuleOAuthIntegration } from "./moduleOAuth";

/**
 * The providers woofx3 has its own OAuth app with, and the endpoints that app
 * is registered for. The ids must match the `integration` literal of
 * `integrationCredentials` in schema.ts.
 *
 * The endpoints are what keep the app's authorizations with the provider: the
 * engine exchanges a code at the manifest's `tokenUrl` and sends tokens only to
 * its `hosts`, so a module could otherwise name the provider's id with its own
 * endpoints and collect the code, the PKCE verifier and the tokens issued to
 * woofx3's app.
 */
export const PLATFORM_OAUTH_PROVIDERS = {
  spotify: {
    authorizeUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    hosts: ["api.spotify.com"],
  },
} as const satisfies Record<string, { authorizeUrl: string; tokenUrl: string; hosts: readonly string[] }>;

export type PlatformOAuthProviderId = keyof typeof PLATFORM_OAUTH_PROVIDERS;

export function isPlatformOAuthProvider(id: string): id is PlatformOAuthProviderId {
  return Object.keys(PLATFORM_OAUTH_PROVIDERS).includes(id);
}

/**
 * Whether woofx3's app may be used for this declaration: a provider woofx3 has
 * an app with, exactly the endpoints that app is registered for, tokens sent
 * only to its hosts, and no client secret of the module's own, which the
 * engine would otherwise pair with woofx3's client id.
 */
export function platformAppFits(integration: ModuleOAuthIntegration): boolean {
  if (!isPlatformOAuthProvider(integration.id)) {
    return false;
  }
  const provider = PLATFORM_OAUTH_PROVIDERS[integration.id];
  const allowedHosts: readonly string[] = provider.hosts;
  return (
    integration.authorizeUrl === provider.authorizeUrl &&
    integration.tokenUrl === provider.tokenUrl &&
    integration.hosts.every((host) => allowedHosts.includes(host)) &&
    integration.clientSecretSetting === undefined
  );
}

/**
 * Which OAuth app a module's integration connect uses. A module's own app
 * always wins. Without one, a managed instance (an engine woofx3 runs) uses
 * the app woofx3 provides (`integrationCredentials`) when the declaration fits
 * it (`platformAppFits`); an external instance, whose engine its owner runs,
 * must bring its own. `missing` says which of the two is absent, so the
 * message can say what to do about it.
 *
 * A client id that is one of woofx3's apps is never the module's own, however
 * it got into the setting (a manifest `defaultValue` can put it there): it is
 * held to `platformAppFits` like the app it is.
 */
export type IntegrationClientId = { clientId: string } | { missing: "platform_app" | "module_app" };

export function chooseIntegrationClientId(input: {
  integration: ModuleOAuthIntegration;
  moduleClientId: string | undefined;
  hosting: "managed" | "external" | undefined;
  platformClientIds: Partial<Record<PlatformOAuthProviderId, string>>;
}): IntegrationClientId {
  const platformIds: string[] = Object.values(input.platformClientIds).filter((id): id is string => Boolean(id));
  if (input.moduleClientId && !platformIds.includes(input.moduleClientId)) {
    return { clientId: input.moduleClientId };
  }
  if (input.hosting !== "managed" || !platformAppFits(input.integration)) {
    return { missing: "module_app" };
  }
  const platformClientId = isPlatformOAuthProvider(input.integration.id)
    ? input.platformClientIds[input.integration.id]
    : undefined;
  if (platformClientId) {
    return { clientId: platformClientId };
  }
  return { missing: "platform_app" };
}
