/**
 * Rules for applying setup choices once the engine is ready (see
 * convex/setupApply.ts). Pure, so they can be tested without a runtime.
 */

import { TWITCH_SETUP_MODULE_ID } from "./setupPlatforms";

/** How one starter pack item install went; mirrors StarterInstallOutcome in convex/starterPacks.ts. */
export interface PackItemOutcome {
  outcome: "installed" | "already-installed" | "pending" | "conflict" | "busy" | "unavailable" | "failed";
  message?: string;
}

export type PackApplyStatus =
  | { status: "installed" }
  | { status: "pending"; error?: string }
  | { status: "failed"; error: string };

/**
 * A pack's state from its items' outcomes.
 *
 * - installed: every item is in place. A command whose name the streamer
 *   already uses counts as in place, because a starter pack never replaces
 *   their own command.
 * - failed: an item failed outright.
 * - pending: an item is waiting on something that may still arrive. Right
 *   after a module installs, its triggers and actions reach Convex by webhook
 *   a little later, so an item can read as unavailable at first.
 */
export function packStatusFromOutcomes(outcomes: readonly PackItemOutcome[]): PackApplyStatus {
  const failed = outcomes.find((item) => item.outcome === "failed");
  if (failed) {
    return { status: "failed", error: failed.message ?? "An item failed to install." };
  }
  const waiting = outcomes.find(
    (item) => item.outcome === "pending" || item.outcome === "busy" || item.outcome === "unavailable"
  );
  if (waiting) {
    return waiting.message === undefined ? { status: "pending" } : { status: "pending", error: waiting.message };
  }
  return { status: "installed" };
}

/**
 * What applying installs. A preview's password account cannot connect Twitch
 * and usually unticks it, yet the default alerts and their test events need
 * its triggers, and the module does not need a linked account to install. So a
 * preview installs it regardless, with nobody to ask for its permissions.
 */
export function platformsToApply<T extends { marketplaceModuleId: string }>(
  platforms: readonly T[],
  preview: boolean
): (T | ImplicitPlatform)[] {
  if (!preview || platforms.some((platform) => platform.marketplaceModuleId === TWITCH_SETUP_MODULE_ID)) {
    return [...platforms];
  }
  return [
    ...platforms,
    {
      marketplaceModuleId: TWITCH_SETUP_MODULE_ID,
      approvedPermissions: [],
      approvedLocalEndpoints: [],
      implicit: true,
    },
  ];
}

export interface ImplicitPlatform {
  marketplaceModuleId: string;
  approvedPermissions: string[];
  approvedLocalEndpoints: string[];
  /** Installed for a preview, not chosen; it approves whatever the build asks for. */
  implicit: true;
}

/**
 * Whether applying seeds the defaults. Only an instance the first-run path made
 * is known to be empty; any other may hold a streamer's own scenes and alerts,
 * which default ones would play on top of, however its setup row looks.
 */
export function seedsDefaults(row: { firstRunAt?: number }): boolean {
  return row.firstRunAt !== undefined;
}

/** Settles what a run leaves pending once no retry is left, as a failure with the reason it was waiting. */
export function settlePending<T extends { status: "installed" | "pending" | "failed"; error?: string }>(entry: T): T {
  return entry.status === "pending"
    ? { ...entry, status: "failed", error: entry.error ?? "Timed out waiting to install." }
    : entry;
}

/** Undoes `settlePending` for a retry, keeping the reason until the new attempt replaces it. */
export function reopenFailed<T extends { status: "installed" | "pending" | "failed" }>(entry: T): T {
  return entry.status === "failed" ? { ...entry, status: "pending" } : entry;
}

/**
 * Delays before each retry of packs still pending, in milliseconds. After the
 * last one a pack that is still pending is marked failed, with the reason it
 * was waiting.
 */
export const PACK_RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000] as const;

/** The delay before the next retry after `attempts` runs, or null when none are left. */
export function nextApplyDelay(attempts: number): number | null {
  return PACK_RETRY_DELAYS_MS[attempts - 1] ?? null;
}

/**
 * An apply that has held its claim this long is taken to have died (an action
 * timeout, a crash) and no longer blocks another. Longer than a slow run:
 * several module downloads plus the engine's per-item confirmation waits.
 */
export const APPLY_CLAIM_TTL_MS = 10 * 60_000;
