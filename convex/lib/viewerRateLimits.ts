import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Limits on viewer sign-in and role checks.
 *
 * Login start and handoff exchange are unauthenticated: neither knows who is
 * asking (there is no account yet, and Convex HTTP actions see no client
 * address), so each bucket is deployment-wide, a ceiling against floods set
 * well above what ordinary page traffic needs. Each one-time value is 256
 * random bits, so these limits are not what stops guessing.
 *
 * Role refreshes are keyed by viewer and spent only on calls that reach the
 * platform. The role cache already answers repeat views, so the bucket covers
 * a viewer moving between many channels and stops a script holding one
 * session from spending that viewer's platform quota.
 *
 * Form submissions are keyed by the signed-in viewer. Anonymous ones have no
 * key here: the edge limits them per client address, and Turnstile stands in
 * for an identity.
 */
export const viewerRateLimiter = new RateLimiter(components.rateLimiter, {
  viewerLoginStart: { kind: "token bucket", rate: 6000, period: HOUR, capacity: 600 },
  viewerHandoffExchange: { kind: "token bucket", rate: 6000, period: HOUR, capacity: 600 },
  viewerRolesRefresh: { kind: "token bucket", rate: 120, period: HOUR, capacity: 20 },
  viewerFormSubmit: { kind: "token bucket", rate: 30, period: HOUR, capacity: 5 },
});
