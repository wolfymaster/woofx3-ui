import { describe, expect, test } from "bun:test";
import { chooseIntegrationClientId, platformAppFits } from "./integrationClientId";
import type { ModuleOAuthIntegration } from "./moduleOAuth";

const SPOTIFY: ModuleOAuthIntegration = {
  id: "spotify",
  authorizeUrl: "https://accounts.spotify.com/authorize",
  tokenUrl: "https://accounts.spotify.com/api/token",
  scopes: ["user-read-playback-state"],
  clientIdSetting: "clientId",
  hosts: ["api.spotify.com"],
};

describe("platformAppFits", () => {
  test("fits a declaration of the provider's own endpoints", () => {
    expect(platformAppFits(SPOTIFY)).toBe(true);
  });

  test("refuses a declaration that would send the code or tokens anywhere else", () => {
    const refused: ModuleOAuthIntegration[] = [
      { ...SPOTIFY, tokenUrl: "https://attacker.example/token" },
      { ...SPOTIFY, authorizeUrl: "https://attacker.example/authorize" },
      { ...SPOTIFY, hosts: ["api.spotify.com", "attacker.example"] },
      { ...SPOTIFY, clientSecretSetting: "clientSecret" },
      { ...SPOTIFY, id: "github" },
      { ...SPOTIFY, id: "toString" },
    ];
    for (const integration of refused) {
      expect(platformAppFits(integration)).toBe(false);
    }
  });
});

describe("chooseIntegrationClientId", () => {
  test("uses the module's own app on any instance", () => {
    for (const hosting of ["managed", "external", undefined] as const) {
      expect(
        chooseIntegrationClientId({
          integration: SPOTIFY,
          moduleClientId: "own",
          hosting,
          platformClientIds: { spotify: "platform" },
        })
      ).toEqual({ clientId: "own" });
    }
  });

  test("gives a managed instance the platform's app", () => {
    expect(
      chooseIntegrationClientId({
        integration: SPOTIFY,
        moduleClientId: undefined,
        hosting: "managed",
        platformClientIds: { spotify: "platform" },
      })
    ).toEqual({ clientId: "platform" });
  });

  test("says the platform's app is missing on a managed instance", () => {
    expect(
      chooseIntegrationClientId({
        integration: SPOTIFY,
        moduleClientId: "",
        hosting: "managed",
        platformClientIds: {},
      })
    ).toEqual({ missing: "platform_app" });
  });

  test("never gives an external instance the platform's app", () => {
    for (const hosting of ["external", undefined] as const) {
      expect(
        chooseIntegrationClientId({
          integration: SPOTIFY,
          moduleClientId: undefined,
          hosting,
          platformClientIds: { spotify: "platform" },
        })
      ).toEqual({ missing: "module_app" });
    }
  });

  test("holds a module's setting naming one of woofx3's apps to that app's rules", () => {
    const attacker = { ...SPOTIFY, id: "spotyfi", tokenUrl: "https://attacker.example/token" };
    for (const integration of [attacker, { ...SPOTIFY, tokenUrl: "https://attacker.example/token" }]) {
      expect(
        chooseIntegrationClientId({
          integration,
          moduleClientId: "platform",
          hosting: "managed",
          platformClientIds: { spotify: "platform" },
        })
      ).toEqual({ missing: "module_app" });
    }
    expect(
      chooseIntegrationClientId({
        integration: SPOTIFY,
        moduleClientId: "platform",
        hosting: "external",
        platformClientIds: { spotify: "platform" },
      })
    ).toEqual({ missing: "module_app" });
    expect(
      chooseIntegrationClientId({
        integration: SPOTIFY,
        moduleClientId: "platform",
        hosting: "managed",
        platformClientIds: { spotify: "platform" },
      })
    ).toEqual({ clientId: "platform" });
  });

  test("never gives the platform's app to a declaration it does not fit", () => {
    expect(
      chooseIntegrationClientId({
        integration: { ...SPOTIFY, tokenUrl: "https://attacker.example/token" },
        moduleClientId: undefined,
        hosting: "managed",
        platformClientIds: { spotify: "platform" },
      })
    ).toEqual({ missing: "module_app" });
  });
});
