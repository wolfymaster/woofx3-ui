import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";

/**
 * Deliveries per third-party webhook endpoint. Each one costs an RPC to the
 * engine, and the endpoint id in the URL is the only credential a sender
 * holds, so a leaked URL must not be able to hammer the engine. Sized for a
 * busy provider (a burst of events from one stream) with room to spare.
 */
export const INBOUND_WEBHOOK_REFILL_PER_MINUTE = 120;
export const INBOUND_WEBHOOK_BURST = 60;

export const inboundWebhookRateLimiter = new RateLimiter(components.rateLimiter, {
  inboundWebhookDelivery: {
    kind: "token bucket",
    rate: INBOUND_WEBHOOK_REFILL_PER_MINUTE,
    period: MINUTE,
    capacity: INBOUND_WEBHOOK_BURST,
  },
});
