/**
 * Module keys are composite: `{marketplaceId}:{version}:{shaPrefix}` — e.g.
 * `woofx3_twitch:0.1.1:eb5e20f`. Only the leading segment is stable across
 * versions, so it is the module's identity: what `/modules/:id` routes on, and
 * what the marketplace is queried with.
 */
export function bareModuleKey(moduleKey: string | undefined): string | undefined {
  if (!moduleKey) {
    return undefined;
  }
  return moduleKey.split(":")[0] || undefined;
}
