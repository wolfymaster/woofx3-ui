import { ENGINE_SYNC_CONFIG } from "./config";

/**
 * How stale `instances.lastEngineActivityAt` may get before a callback from
 * the engine rewrites it. Every patch to an instance re-runs each query that
 * reads it, and a busy engine calls back many times a minute; an hour is
 * still well inside the day-long inactivity window the sweep gates on.
 */
export const ENGINE_ACTIVITY_WRITE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The patch recording that the engine called Convex at `nowMs`, or null when
 * the stored value is recent enough to leave alone.
 */
export function engineActivityPatch(
  lastEngineActivityAt: number | undefined,
  nowMs: number
): { lastEngineActivityAt: number } | null {
  if (lastEngineActivityAt !== undefined && nowMs - lastEngineActivityAt < ENGINE_ACTIVITY_WRITE_INTERVAL_MS) {
    return null;
  }
  return { lastEngineActivityAt: nowMs };
}

/**
 * Whether the sweep should sync the instance: its engine called Convex within
 * the inactivity window. An instance with no recorded call counts as idle, so
 * an engine nobody has heard from is not polled on a schedule; the first
 * callback from it makes it eligible.
 */
export function isEngineActive(lastEngineActivityAt: number | undefined, nowMs: number): boolean {
  return (lastEngineActivityAt ?? 0) >= nowMs - ENGINE_SYNC_CONFIG.inactivityThresholdMs;
}
