import type { RefreshRolesResult } from "@convex/viewerRoles";

/**
 * What the page does after asking `viewerRoles.refresh`, while the page read
 * still reports `rolesStale`:
 * - `settled`: the roles were stored; the page read re-runs on its own.
 * - `retry`: the platform or the rate limit said not now; ask again later,
 *   without telling the viewer more than that it is still checking.
 * - `reauth`: the viewer's Twitch grant is gone; only a new sign-in helps.
 * - `signed_out`: the session has ended; forget the token.
 * - `stop`: nothing the viewer can do on this page changes the answer.
 */
export type RoleRefreshStep = "settled" | "retry" | "reauth" | "signed_out" | "stop";

/** `error` is a refresh that could not reach Convex at all. */
export function roleRefreshStep(result: RefreshRolesResult | "error"): RoleRefreshStep {
  if (result === "error") {
    return "retry";
  }
  if (result.ok) {
    return "settled";
  }
  switch (result.error) {
    case "unavailable":
    case "rate_limited":
      return "retry";
    case "reauth_required":
      return "reauth";
    case "not_signed_in":
      return "signed_out";
    case "page_not_found":
    case "broadcaster_not_linked":
    case "platform_mismatch":
      return "stop";
  }
}

export interface RoleRefreshRetryConfig {
  /** The first retry's delay before jitter. */
  baseMs: number;
  /** The longest delay; retries stay here once they reach it. */
  maxMs: number;
}

/**
 * Thirty seconds lets the server's one-minute outage memory run out within a
 * retry or two; five minutes keeps a page left open checking without
 * spending the viewer's refresh budget.
 */
export const ROLE_REFRESH_RETRY: RoleRefreshRetryConfig = { baseMs: 30_000, maxMs: 5 * 60_000 };

/**
 * How long to wait before retry number `attempt` (0 for the first):
 * exponential, capped at `maxMs`, with jitter taking up to half off so many
 * open pages do not retry in step. `random` is in [0, 1).
 */
export function roleRefreshRetryDelay(attempt: number, config: RoleRefreshRetryConfig, random: () => number): number {
  const exponential = Math.min(config.maxMs, config.baseMs * 2 ** attempt);
  return Math.round(exponential * (1 - random() / 2));
}
