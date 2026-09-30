/**
 * Rules for applying setup choices once the engine is ready (see
 * convex/setupApply.ts). Pure, so they can be tested without a runtime.
 */

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
