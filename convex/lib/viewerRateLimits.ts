import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Limits on the unauthenticated steps of viewer sign-in. Neither step knows
 * who is asking (there is no account yet, and Convex HTTP actions see no
 * client address), so each bucket is deployment-wide: a ceiling against
 * floods, set well above what ordinary page traffic needs. Each one-time value
 * is 256 random bits, so the limits are not what stops guessing.
 */
export const viewerRateLimiter = new RateLimiter(components.rateLimiter, {
  viewerLoginStart: { kind: "token bucket", rate: 6000, period: HOUR, capacity: 600 },
  viewerHandoffExchange: { kind: "token bucket", rate: 6000, period: HOUR, capacity: 600 },
});
