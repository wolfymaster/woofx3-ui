import { describe, expect, test } from "bun:test";
import { chooseIntegrationClientId } from "./integrationClientId";

describe("chooseIntegrationClientId", () => {
  test("uses the module's own app on any instance", () => {
    for (const hosting of ["managed", "external", undefined] as const) {
      expect(chooseIntegrationClientId({ moduleClientId: "own", hosting, platformClientId: "platform" })).toEqual({
        clientId: "own",
      });
    }
  });

  test("gives a managed instance the platform's app", () => {
    expect(
      chooseIntegrationClientId({ moduleClientId: undefined, hosting: "managed", platformClientId: "platform" })
    ).toEqual({ clientId: "platform" });
  });

  test("says the platform's app is missing on a managed instance", () => {
    expect(chooseIntegrationClientId({ moduleClientId: "", hosting: "managed", platformClientId: undefined })).toEqual({
      missing: "platform_app",
    });
  });

  test("never gives an external instance the platform's app", () => {
    for (const hosting of ["external", undefined] as const) {
      expect(chooseIntegrationClientId({ moduleClientId: undefined, hosting, platformClientId: "platform" })).toEqual({
        missing: "module_app",
      });
    }
  });
});
