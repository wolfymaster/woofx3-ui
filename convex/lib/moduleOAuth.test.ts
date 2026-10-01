import { describe, expect, test } from "bun:test";
import {
  integrationOfModuleOAuthState,
  moduleOAuthAuthorizeUrl,
  moduleOAuthIntegrationIds,
  moduleOAuthStateIntegration,
  readModuleOAuthIntegration,
} from "./moduleOAuth";

const MANIFEST = {
  id: "spotify",
  oauth: [
    {
      id: "spotify",
      authorizeUrl: "https://accounts.spotify.com/authorize",
      tokenUrl: "https://accounts.spotify.com/api/token",
      scopes: ["user-read-playback-state", "user-modify-playback-state"],
      clientIdSetting: "clientId",
      clientSecretSetting: "clientSecret",
      hosts: ["api.spotify.com"],
    },
  ],
};

describe("readModuleOAuthIntegration", () => {
  test("reads the integration the button names", () => {
    expect(readModuleOAuthIntegration(MANIFEST, "spotify")).toEqual({
      id: "spotify",
      authorizeUrl: "https://accounts.spotify.com/authorize",
      scopes: ["user-read-playback-state", "user-modify-playback-state"],
      clientIdSetting: "clientId",
    });
  });

  test("knows no integration a manifest does not declare, or declares wrongly", () => {
    expect(readModuleOAuthIntegration(MANIFEST, "github")).toBeNull();
    expect(readModuleOAuthIntegration({}, "spotify")).toBeNull();
    expect(readModuleOAuthIntegration(null, "spotify")).toBeNull();
    const insecure = { oauth: [{ ...MANIFEST.oauth[0], authorizeUrl: "http://accounts.spotify.com/authorize" }] };
    expect(readModuleOAuthIntegration(insecure, "spotify")).toBeNull();
  });

  test("lists the ids a module's buttons may connect", () => {
    expect(moduleOAuthIntegrationIds(MANIFEST)).toEqual(["spotify"]);
    expect(moduleOAuthIntegrationIds({ oauth: "nope" })).toEqual([]);
  });
});

describe("moduleOAuthAuthorizeUrl", () => {
  test("asks for the declared scopes with PKCE and this dashboard's callback", () => {
    const integration = readModuleOAuthIntegration(MANIFEST, "spotify");
    if (!integration) {
      throw new Error("integration should read");
    }
    const url = new URL(
      moduleOAuthAuthorizeUrl({
        integration,
        clientId: "module-app",
        redirectUri: "https://prod.convex.site/api/integrations/oauth/callback",
        state: "s.t.u",
        codeChallenge: "challenge",
      })
    );
    expect(url.origin + url.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "module-app",
      response_type: "code",
      redirect_uri: "https://prod.convex.site/api/integrations/oauth/callback",
      scope: "user-read-playback-state user-modify-playback-state",
      state: "s.t.u",
      code_challenge: "challenge",
      code_challenge_method: "S256",
    });
  });
});

test("a module OAuth state is told apart from a built-in integration's", () => {
  expect(integrationOfModuleOAuthState(moduleOAuthStateIntegration("spotify"))).toBe("spotify");
  expect(integrationOfModuleOAuthState("spotify")).toBeNull();
  expect(integrationOfModuleOAuthState("oauth:")).toBeNull();
});
