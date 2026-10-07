import type { LocalEndpoint } from "./localEndpoints";

/**
 * The discoverers built into the companion (`discover.known`), and the modules
 * each may hand a secret to. A discoverer can read a password from the
 * streamer's PC (obs-websocket's from OBS's config file), so any module could
 * otherwise collect it by declaring that discoverer. A module outside its list
 * may still use the discoverer's host and port, but gets no secret from the
 * companion. The companion enforces the same table
 * (companion/src-tauri/src/integrations.rs); keep the two in step.
 */
export const KNOWN_DISCOVERER_SECRET_MODULES: ReadonlyMap<string, readonly string[]> = new Map([
  ["obs-websocket", ["woofx3_obs"]],
]);

/** Whether the companion may fill in this endpoint's secret setting for this module. */
export function companionMayProvideSecret(moduleId: string, endpoint: LocalEndpoint): boolean {
  const known = endpoint.discover?.known;
  if (known === undefined) {
    return false;
  }
  return KNOWN_DISCOVERER_SECRET_MODULES.get(known)?.includes(moduleId) ?? false;
}
