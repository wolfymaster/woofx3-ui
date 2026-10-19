/**
 * Module keys are composite: `{manifestId}:{version}:{shaPrefix}` — e.g.
 * `woofx3_twitch:0.1.1:eb5e20f`. Only the leading segment is stable across
 * versions and editions, so it is the module's identity: what `/modules/:id`
 * routes on. Which marketplace listing is installed is a different question,
 * answered by `installedListing` in `convex/lib/marketplaceInstallIdentity.ts`.
 */
export function bareModuleKey(moduleKey: string | undefined): string | undefined {
  if (!moduleKey) {
    return undefined;
  }
  return moduleKey.split(":")[0] || undefined;
}
