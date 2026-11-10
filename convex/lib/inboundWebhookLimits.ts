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
/**
 * Concurrent deliveries to one endpoint all write its bucket, and Convex
 * aborts the losers. The component advises about half the peak requests per
 * second as shards, each holding ten or more of the capacity: 60 / 10 = 6.
 */
export const INBOUND_WEBHOOK_SHARDS = 6;
/** Told to a sender whose delivery lost a write race, so it retries after the burst. */
export const INBOUND_WEBHOOK_CONFLICT_RETRY_SECONDS = 1;

export const inboundWebhookRateLimiter = new RateLimiter(components.rateLimiter, {
  inboundWebhookDelivery: {
    kind: "token bucket",
    rate: INBOUND_WEBHOOK_REFILL_PER_MINUTE,
    period: MINUTE,
    capacity: INBOUND_WEBHOOK_BURST,
    shards: INBOUND_WEBHOOK_SHARDS,
  },
});

export type InboundWebhookAdmission = { ok: true } | { ok: false; retryAfterSeconds: number };

type BucketLimit = () => Promise<{ ok: boolean; retryAfter?: number }>;

/**
 * Convex's optimistic concurrency failure. It reaches the caller of the
 * component as a plain Error: Convex gives it no error name, code or
 * ConvexError data to match, so the backend's message text is matched. The
 * test pins that text, and must change with it if Convex rewords it.
 */
function isWriteConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes("changed while this mutation was being run");
}

/**
 * Spends one delivery from the bucket. A write conflict is a sender hitting
 * the bucket in a burst, so it is refused like an empty bucket; any other
 * error is a real fault and is rethrown.
 */
export async function admitInboundWebhook(limit: BucketLimit): Promise<InboundWebhookAdmission> {
  try {
    const result = await limit();
    return result.ok ? { ok: true } : { ok: false, retryAfterSeconds: Math.ceil((result.retryAfter ?? 0) / 1000) };
  } catch (err) {
    if (isWriteConflict(err)) {
      return { ok: false, retryAfterSeconds: INBOUND_WEBHOOK_CONFLICT_RETRY_SECONDS };
    }
    throw err;
  }
}
