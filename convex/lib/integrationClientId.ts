/**
 * Which OAuth app an integration connect uses. A module's own app always wins.
 * Without one, a managed instance (an engine woofx3 runs) uses the app woofx3
 * provides (`integrationCredentials`); an external instance, whose engine its
 * owner runs, must bring its own. `missing` says which of the two is absent,
 * so the message can say what to do about it.
 */
export type IntegrationClientId = { clientId: string } | { missing: "platform_app" | "module_app" };

export function chooseIntegrationClientId(input: {
  moduleClientId: string | undefined;
  hosting: "managed" | "external" | undefined;
  platformClientId: string | undefined;
}): IntegrationClientId {
  if (input.moduleClientId) {
    return { clientId: input.moduleClientId };
  }
  if (input.hosting !== "managed") {
    return { missing: "module_app" };
  }
  if (input.platformClientId) {
    return { clientId: input.platformClientId };
  }
  return { missing: "platform_app" };
}
