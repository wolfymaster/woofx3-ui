import type { HttpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { BATCH_FAILED_CODE, type EngineEventBatchResponse, engineEventBatchSchema } from "./lib/engineEvents/contract";
import { SIGNATURE_HEADER, verifySignature } from "./lib/maintenanceSignature";
import { logger } from "./logger";

export const ENGINE_EVENT_BATCH_PATH = "/api/engine-events/batch";

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Batches of engine events from the woofx3 maintenance event queue. The
 * queue signs each batch with the same secret as its provisioning callbacks
 * and acknowledges each event by its result here. The whole batch applies in
 * one mutation, so a 200 always means every result is final, and a 500 means
 * nothing was applied: the relay splits the batch to find the event that
 * failed.
 */
export function registerEngineEventRoutes(http: HttpRouter): void {
  http.route({
    path: ENGINE_EVENT_BATCH_PATH,
    method: "POST",
    handler: httpAction(async (ctx, request) => {
      const secret = process.env.MAINTENANCE_WEBHOOK_SECRET;
      if (!secret) {
        logger.error("engine event batch: MAINTENANCE_WEBHOOK_SECRET is not configured");
        return errorResponse(503, "not_configured", "Engine event batches are not configured");
      }
      const body = await request.text();
      const verification = await verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret, new Date());
      if (!verification.valid) {
        logger.warn("engine event batch: rejected signature", { reason: verification.reason });
        return errorResponse(401, "unauthorized", verification.reason);
      }
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return errorResponse(400, "invalid_batch", "The body is not JSON");
      }
      const parsed = engineEventBatchSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn("engine event batch: invalid body", { issues: parsed.error.issues.slice(0, 5) });
        return errorResponse(400, "invalid_batch", parsed.error.issues[0]?.message ?? "The batch is invalid");
      }
      const { batchId, events } = parsed.data;
      try {
        const results = await ctx.runMutation(internal.engineEvents.applyBatch, {
          events: events.map((event) => ({
            queueId: event.queueId,
            instanceId: event.instanceId,
            tokenHash: event.tokenHash,
            envelopeJson: JSON.stringify(event.envelope),
          })),
        });
        const answer: EngineEventBatchResponse = { results };
        return new Response(JSON.stringify(answer), { headers: { "Content-Type": "application/json" } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("engine event batch: failed", { batchId, events: events.length, error: message });
        return errorResponse(500, BATCH_FAILED_CODE, message);
      }
    }),
  });
}
