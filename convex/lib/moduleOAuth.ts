/**
 * A module's OAuth integration (its manifest's `oauth[]`), connected through
 * the dashboard and used by the engine's `ctx.oauth`. The dashboard only runs
 * the browser half: it sends the streamer to the provider and hands the
 * authorization code to the engine, which exchanges it and keeps the tokens
 * where module code cannot read them. Must match `OAuthIntegration` in the
 * engine's barkloader/lib_sandbox/src/oauth.rs.
 */
export interface ModuleOAuthIntegration {
  id: string;
  authorizeUrl: string;
  scopes: string[];
  clientIdSetting: string;
}

/**
 * The `moduleIntegrationState.integration` of a module OAuth connect, kept
 * apart from the built-in integrations' (`spotify`) that share the table.
 */
export function moduleOAuthStateIntegration(id: string): string {
  return `oauth:${id}`;
}

/** The integration id a `moduleIntegrationState.integration` names, or null when it is not a module OAuth connect. */
export function integrationOfModuleOAuthState(stateIntegration: string): string | null {
  return stateIntegration.startsWith("oauth:") ? stateIntegration.slice("oauth:".length) || null : null;
}

/** The manifest's integration `id`, or null when it declares none (or not in a shape the engine would have installed). */
export function readModuleOAuthIntegration(manifest: unknown, id: string): ModuleOAuthIntegration | null {
  if (typeof manifest !== "object" || manifest === null) {
    return null;
  }
  const integrations = (manifest as { oauth?: unknown }).oauth;
  if (!Array.isArray(integrations)) {
    return null;
  }
  for (const entry of integrations) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    if (raw.id !== id) {
      continue;
    }
    if (typeof raw.authorizeUrl !== "string" || !raw.authorizeUrl.startsWith("https://")) {
      return null;
    }
    if (typeof raw.clientIdSetting !== "string" || raw.clientIdSetting === "") {
      return null;
    }
    const scopes = Array.isArray(raw.scopes) ? raw.scopes.filter((s): s is string => typeof s === "string") : [];
    return { id, authorizeUrl: raw.authorizeUrl, scopes, clientIdSetting: raw.clientIdSetting };
  }
  return null;
}

/** The ids of the manifest's OAuth integrations, for the settings buttons that connect them. */
export function moduleOAuthIntegrationIds(manifest: unknown): string[] {
  if (typeof manifest !== "object" || manifest === null) {
    return [];
  }
  const integrations = (manifest as { oauth?: unknown }).oauth;
  if (!Array.isArray(integrations)) {
    return [];
  }
  return integrations.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
      ? [(entry as { id: string }).id]
      : []
  );
}

/** The provider's authorize URL for this connect: authorization code with PKCE (S256). */
export function moduleOAuthAuthorizeUrl(input: {
  integration: ModuleOAuthIntegration;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.integration.authorizeUrl);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  if (input.integration.scopes.length > 0) {
    url.searchParams.set("scope", input.integration.scopes.join(" "));
  }
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
