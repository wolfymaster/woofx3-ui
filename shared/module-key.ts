/**
 * The bare module key: the first segment of an installed module's versioned key.
 *
 * A module is installed under a key carrying its version and content hash
 * (`woofx3_twitch:0.1.1:eb5e20f`). Engine records that belong to a module name
 * it by its bare key instead (`createdByRef: "woofx3_twitch"`), because a
 * trigger keeps working across module upgrades.
 */
export function bareModuleKey(moduleKey: string | undefined): string | undefined {
  return moduleKey?.split(":")[0] || undefined;
}
