import type { CallbackEnvelope } from "@woofx3/api/webhooks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { recordEngineEvent } from "./engineEventLog";
import { RECEIPT_CLEANUP_BATCH, RECEIPT_RETENTION_MS } from "./lib/engineEvents/config";
import { applyEngineEvent, type EngineEventOutcome } from "./lib/engineEvents/dispatch";
import { engineActivityPatch } from "./lib/engineSync/activity";
import { logger } from "./logger";

export type ReceivedEventOutcome = EngineEventOutcome | { kind: "duplicate" };

export type WebhookEventResult = ReceivedEventOutcome | { kind: "unauthorized" };

/**
 * Logs, applies and records activity for one event, all in this transaction,
 * unless its envelope id was already applied for this instance. Shared by
 * every path an engine event arrives on, so they cannot drift. An envelope
 * without an id (an engine too old to send one) applies without a receipt.
 */
export async function receiveEngineEvent(
  ctx: MutationCtx,
  instance: Doc<"instances">,
  envelope: CallbackEnvelope
): Promise<ReceivedEventOutcome> {
  const envelopeId = typeof envelope.id === "string" && envelope.id !== "" ? envelope.id : null;
  if (envelopeId !== null) {
    const receipt = await ctx.db
      .query("engineEventReceipts")
      .withIndex("by_instance_envelope", (q) => q.eq("instanceId", instance._id).eq("envelopeId", envelopeId))
      .first();
    if (receipt) {
      return { kind: "duplicate" };
    }
    await ctx.db.insert("engineEventReceipts", { instanceId: instance._id, envelopeId, receivedAt: Date.now() });
  }
  // Any event shows the engine is running and may hold changes a scheduled
  // sync would mirror.
  const activity = engineActivityPatch(instance.lastEngineActivityAt, Date.now());
  if (activity) {
    await ctx.db.patch(instance._id, activity);
  }
  await recordEngineEvent(ctx, {
    instanceId: instance._id,
    eventType: envelope.data?.type ?? envelope.type ?? "",
    // Unescaped, as the engine sent it, so the event can be re-fired.
    payload: JSON.stringify(envelope.data ?? null),
    envelopeId: envelopeId ?? undefined,
    engineEventTime: typeof envelope.time === "string" ? envelope.time : undefined,
  });
  return applyEngineEvent(ctx, instance, envelope);
}

/**
 * One engine event from the legacy webhook route, authenticated here rather
 * than in the route so that the whole event costs one function call. `body`
 * is the raw JSON: an engine payload can hold `$`-prefixed keys, which a
 * Convex argument cannot.
 */
export const applyFromWebhook = internalMutation({
  args: { webhookSecret: v.string(), body: v.string() },
  handler: async (ctx, { webhookSecret, body }): Promise<WebhookEventResult> => {
    const instance = await ctx.db
      .query("instances")
      .withIndex("by_webhook_secret", (q) => q.eq("webhookSecret", webhookSecret))
      .first();
    if (!instance) {
      logger.warn("webhook: unauthorized - no instance found for provided secret");
      return { kind: "unauthorized" };
    }
    const envelope = JSON.parse(body) as CallbackEnvelope;
    logger.info("webhook: event received", { instanceId: instance._id, type: envelope.type, payload: body });
    return receiveEngineEvent(ctx, instance, envelope);
  },
});

/** Deletes receipts older than RECEIPT_RETENTION_MS; runs on a daily cron. */
export const cleanupOldReceipts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("engineEventReceipts")
      .withIndex("by_received_at", (q) => q.lt("receivedAt", Date.now() - RECEIPT_RETENTION_MS))
      .take(RECEIPT_CLEANUP_BATCH);
    for (const row of old) {
      await ctx.db.delete(row._id);
    }
    if (old.length === RECEIPT_CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.engineEvents.cleanupOldReceipts, {});
    }
  },
});
