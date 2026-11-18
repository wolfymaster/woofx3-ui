import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";

/**
 * Token buckets for actions that reach a paid or third-party API (Stripe via
 * the plane, Twitch). `capacity` is the burst a person can spend at once;
 * `rate` tokens per hour then refill it. Billing and sponsorship buckets are
 * keyed by the acting user; invitation buckets by the engine, so one admin
 * cannot spend another engine's allowance.
 */
export const ACTION_LIMITS = {
  billingPromoPreview: { kind: "token bucket", rate: 30, period: HOUR, capacity: 10 },
  billingCheckoutStart: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  sponsorshipStart: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  inviteLookup: { kind: "token bucket", rate: 120, period: HOUR, capacity: 20 },
  inviteCreate: { kind: "token bucket", rate: 60, period: HOUR, capacity: 15 },
} as const;

export type ActionLimitName = keyof typeof ACTION_LIMITS;

const actionRateLimiter = new RateLimiter(components.rateLimiter, ACTION_LIMITS);

/** What a refused call carries: `retryAfter` is milliseconds until a token is back. */
export type RateLimitedRefusal = { code: "rate_limited"; message: string; retryAfter: number };

/** Spends one token from `key`'s bucket, or refuses with a coded `rate_limited` error. */
export async function spendActionLimit(
  ctx: Parameters<typeof actionRateLimiter.limit>[0],
  name: ActionLimitName,
  key: string
): Promise<void> {
  const { ok, retryAfter } = await actionRateLimiter.limit(ctx, name, { key });
  if (!ok) {
    const seconds = Math.max(1, Math.ceil(retryAfter / 1000));
    throw new ConvexError<RateLimitedRefusal>({
      code: "rate_limited",
      message: `Too many attempts. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`,
      retryAfter,
    });
  }
}
