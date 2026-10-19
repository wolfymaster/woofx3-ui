import { ENGINE_CAPABILITY_IDS } from "../engineCapabilities";
import { engineBelowMinimum } from "../engineVersion";
import { compareReleases, parseRelease } from "../releaseVersion";

/**
 * Which capabilities recently active engines report, for deciding when a
 * capability check can be retired (docs/patterns/engine-capabilities.md).
 * Pure, so the counting rule is tested apart from Convex paging.
 */

export type Hosting = "managed" | "external";

/** One recently active instance, as ops/reads.ts pages them out. */
export interface EngineReportRow {
  hosting: Hosting;
  version: string | null;
  /** Null when the engine has never had its capabilities recorded. */
  capabilityIds: string[] | null;
}

export interface HostingCounts {
  managed: number;
  external: number;
}

export interface CapabilityCountDto {
  id: string;
  /** Whether this dashboard gates on the id; an engine may list ids it does not. */
  known: boolean;
  have: HostingCounts;
  /** Reported a capability list without this id. Instances with no list are in `unreported` instead. */
  lack: HostingCounts;
}

export interface VersionCountDto {
  /** As the engine reported it; null when it never reported one. */
  version: string | null;
  count: HostingCounts;
  belowMinimum: boolean;
}

export interface EngineCapabilityCountsDto {
  days: number;
  /** Instances whose engine answered Convex at or after this time count as recently active. */
  activeSince: number;
  countedAt: number;
  minimumSupportedVersion: string | null;
  instances: HostingCounts;
  /** Recently active, but no capability list recorded yet: neither have nor lack any id. */
  unreported: HostingCounts;
  belowMinimum: HostingCounts;
  /** Every id this dashboard knows, plus every id any counted engine reported, by id. */
  capabilities: CapabilityCountDto[];
  /** Newest release first, then versions outside the release order, then no version. */
  versions: VersionCountDto[];
}

export function tallyEngineCapabilities(
  rows: readonly EngineReportRow[],
  options: { days: number; activeSince: number; nowMs: number; minimumSupportedVersion: string | null }
): EngineCapabilityCountsDto {
  const instances = zero();
  const unreported = zero();
  const belowMinimum = zero();
  const reportedBy = zero();
  const have = new Map<string, HostingCounts>(ENGINE_CAPABILITY_IDS.map((id) => [id, zero()]));
  const versions = new Map<string | null, HostingCounts>();

  for (const row of rows) {
    instances[row.hosting] += 1;
    const version = versions.get(row.version) ?? zero();
    version[row.hosting] += 1;
    versions.set(row.version, version);
    if (row.version !== null && engineBelowMinimum({ engineVersion: row.version }, options.minimumSupportedVersion)) {
      belowMinimum[row.hosting] += 1;
    }
    if (row.capabilityIds === null) {
      unreported[row.hosting] += 1;
      continue;
    }
    reportedBy[row.hosting] += 1;
    for (const id of new Set(row.capabilityIds)) {
      const counts = have.get(id) ?? zero();
      counts[row.hosting] += 1;
      have.set(id, counts);
    }
  }

  const known: ReadonlySet<string> = new Set(ENGINE_CAPABILITY_IDS);
  return {
    days: options.days,
    activeSince: options.activeSince,
    countedAt: options.nowMs,
    minimumSupportedVersion: options.minimumSupportedVersion,
    instances,
    unreported,
    belowMinimum,
    capabilities: Array.from(have.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, counts]) => ({
        id,
        known: known.has(id),
        have: counts,
        lack: { managed: reportedBy.managed - counts.managed, external: reportedBy.external - counts.external },
      })),
    versions: Array.from(versions.entries())
      .sort(([a], [b]) => compareVersionsNewestFirst(a, b))
      .map(([version, count]) => ({
        version,
        count,
        belowMinimum:
          version !== null && engineBelowMinimum({ engineVersion: version }, options.minimumSupportedVersion),
      })),
  };
}

function zero(): HostingCounts {
  return { managed: 0, external: 0 };
}

function compareVersionsNewestFirst(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  const left = parseRelease(a);
  const right = parseRelease(b);
  if (left && right) {
    return compareReleases(right, left) || (a < b ? -1 : a > b ? 1 : 0);
  }
  if (left || right) {
    return left ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export const DEFAULT_ACTIVE_DAYS = 30;
const MAX_ACTIVE_DAYS = 365;

/** The `days` query parameter: a whole number of days from 1 to 365, defaulting to 30; null when invalid. */
export function parseActiveDays(raw: string | null): number | null {
  if (raw === null || raw === "") {
    return DEFAULT_ACTIVE_DAYS;
  }
  if (!/^\d{1,3}$/.test(raw)) {
    return null;
  }
  const days = Number(raw);
  return days >= 1 && days <= MAX_ACTIVE_DAYS ? days : null;
}
