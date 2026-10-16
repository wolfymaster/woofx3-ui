/**
 * Engine releases are tagged `v<major>.<minor>.<patch>`, optionally with a
 * semver prerelease (`v0.4.0-rc.1`). Anything else an engine can run (a
 * preview build `pr-<n>-<sha7>`, an image an operator placed by hand) has no
 * place in that order.
 */

interface Release {
  core: [number, number, number];
  prerelease: string[];
}

const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseRelease(tag: string): Release | null {
  const match = RELEASE_TAG.exec(tag);
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Semver precedence: negative when `a` is older than `b`, positive when newer, zero when equal. */
export function compareReleases(a: Release, b: Release): number {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) {
      return a.core[i] - b.core[i];
    }
  }
  // A prerelease comes before the release it leads up to.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  const length = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i++) {
    const order = comparePrereleasePart(a.prerelease[i], b.prerelease[i]);
    if (order !== 0) {
      return order;
    }
  }
  return a.prerelease.length - b.prerelease.length;
}

function comparePrereleasePart(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }
  if (aNumeric !== bNumeric) {
    return aNumeric ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether the offered release is an upgrade for an engine running `current`.
 * Only a newer release is: an engine an operator moved past the offered
 * release, or onto a build outside the release order, is left where it is
 * rather than offered a downgrade.
 */
export function isUpgrade(offered: string, current: string | null): boolean {
  if (current === null) {
    return false;
  }
  const to = parseRelease(offered);
  const from = parseRelease(current);
  if (!to || !from) {
    return false;
  }
  return compareReleases(to, from) > 0;
}
