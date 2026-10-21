import { compareReleases, parseRelease } from "./releaseVersion";

/**
 * The oldest engine release this dashboard still supports, or null for no
 * minimum. While null nothing treats any engine as too old.
 *
 * A code constant rather than a deployment env var: retiring a capability
 * check (docs/patterns/engine-capabilities.md) deletes the fallback for
 * engines older than this, so the value has to move in the same reviewed
 * change as that deletion. An env var could be lowered, or differ between
 * preview and production, after the fallback is gone, and nothing would
 * notice.
 */
export const MIN_SUPPORTED_ENGINE_VERSION: string | null = null;

/**
 * Whether the instance's engine last reported a release older than
 * `minimum`. A version this cannot place in release order (`"dev"` from an
 * unstamped build, a preview tag, nothing reported yet) is unknown, not
 * below: there is no evidence the engine is old, and a local build is
 * usually newer than any release.
 */
export function engineBelowMinimum(
  instance: { engineVersion?: string },
  minimum: string | null = MIN_SUPPORTED_ENGINE_VERSION
): boolean {
  if (minimum === null || instance.engineVersion === undefined) {
    return false;
  }
  const floor = parseRelease(minimum);
  const running = parseRelease(instance.engineVersion);
  if (floor === null || running === null) {
    return false;
  }
  return compareReleases(running, floor) < 0;
}
