import { atom } from "nanostores";

/**
 * Whether Convex could reach the instance's engine at its last probe. One
 * store for the whole dashboard, written only by the probe that
 * `session.useLiveConnection` mounts, so any number of readers cost no
 * extra calls.
 */
export const $engineReachable = atom<boolean>(false);

/** How often the engine is probed while the tab is visible. */
export const ENGINE_PROBE_INTERVAL_MS = 10_000;
