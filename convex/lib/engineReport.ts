/**
 * What an instance's engine last told Convex about itself: its release and
 * every capability id it lists. Recorded as a side effect of calls the
 * dashboard already makes (`engineInfo.getEngineInfo` each time the engine
 * connection comes up, `engineCapabilities.get` when a gated screen opens),
 * so an operator can see which engines still need a capability check's
 * fallback. Gating never reads these fields; it always asks the engine.
 */

/** The instance fields this records. */
export interface EngineReportFields {
  engineVersion?: string;
  engineCapabilityIds?: string[];
  engineCapabilitiesSeenAt?: number;
  engineSeenAt?: number;
}

export interface EngineObservation {
  /** Present when the engine answered getEngineInfo; null when that answer had no version. */
  version?: string | null;
  /** Present when the engine answered getEngineCapabilities; empty for an engine that predates it. */
  capabilityIds?: readonly string[];
}

/**
 * How stale a timestamp may get before an unchanged answer is written again.
 * Each write to an instance re-runs every query that read it, and the
 * dashboard asks on every reconnect, so unchanged answers are written at most
 * this often. Readers count activity in days, which this is far finer than.
 */
export const ENGINE_REPORT_REFRESH_MS = 60 * 60 * 1000;

// A self-hosted engine is not trusted to keep its answer small or tidy.
const MAX_VERSION_LENGTH = 64;
const MAX_CAPABILITY_IDS = 256;
const CAPABILITY_ID = /^[a-z][a-zA-Z0-9]{0,31}\.[a-z][a-zA-Z0-9]{0,63}$/;

/** The version string to keep from a getEngineInfo answer, or null when it has none worth keeping. */
export function reportedEngineVersion(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const version = raw.trim();
  return version !== "" && version.length <= MAX_VERSION_LENGTH ? version : null;
}

/**
 * The ids to keep from an engine's list: well-formed `<area>.<feature>` ids,
 * sorted and unique. Anything else could never name a capability.
 */
export function reportedCapabilityIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter((id) => CAPABILITY_ID.test(id))))
    .sort()
    .slice(0, MAX_CAPABILITY_IDS);
}

/**
 * The patch that records `observed` on an instance currently holding
 * `current`, or null when nothing is worth writing: the answer matches what
 * is stored and was last written within ENGINE_REPORT_REFRESH_MS.
 */
export function engineReportPatch(
  current: EngineReportFields,
  observed: EngineObservation,
  nowMs: number
): EngineReportFields | null {
  const patch: EngineReportFields = {};
  let write = isStale(current.engineSeenAt, nowMs);

  if (observed.version !== undefined) {
    const version = observed.version ?? undefined;
    if (version !== current.engineVersion) {
      // Undefined clears a version an older answer left behind.
      patch.engineVersion = version;
      write = true;
    }
  }

  if (observed.capabilityIds !== undefined) {
    const ids = reportedCapabilityIds(observed.capabilityIds);
    const changed = !sameIds(current.engineCapabilityIds, ids);
    if (changed || isStale(current.engineCapabilitiesSeenAt, nowMs)) {
      patch.engineCapabilityIds = ids;
      patch.engineCapabilitiesSeenAt = nowMs;
      write = true;
    }
  }

  if (!write) {
    return null;
  }
  patch.engineSeenAt = nowMs;
  return patch;
}

function isStale(seenAt: number | undefined, nowMs: number): boolean {
  return seenAt === undefined || nowMs - seenAt >= ENGINE_REPORT_REFRESH_MS;
}

function sameIds(stored: readonly string[] | undefined, ids: readonly string[]): boolean {
  return stored !== undefined && stored.length === ids.length && stored.every((id, index) => id === ids[index]);
}
