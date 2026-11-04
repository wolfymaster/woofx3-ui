import type { CallbackEnvelope } from "@woofx3/api/webhooks";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { recordEngineEvent } from "./engineEventLog";
import { RECEIPT_CLEANUP_BATCH, RECEIPT_RETENTION_MS } from "./lib/engineEvents/config";
import { type BatchEventResult, REJECTION_REASONS } from "./lib/engineEvents/contract";
import { applyEngineEvent, type EngineEventOutcome } from "./lib/engineEvents/dispatch";
import { engineActivityPatch } from "./lib/engineSync/activity";

export type ReceivedEventOutcome = EngineEventOutcome | { kind: "duplicate" };

/**
 * Records that the engine called Convex, which the engine sync sweep reads as
 * the instance being active; throttled by engineActivityPatch.
 */
export async function recordEngineActivityIfDue(ctx: MutationCtx, instance: Doc<"instances">): Promise<void> {
  const activity = engineActivityPatch(instance.lastEngineActivityAt, Date.now());
  if (activity) {
    await ctx.db.patch(instance._id, activity);
  }
}

/**
 * Logs and applies one event in this transaction, unless its envelope id was
 * already applied for this instance. Shared by every path an engine event
 * arrives on, so they cannot drift. An envelope without an id (an engine too
 * old to send one) applies without a receipt, and so does an invalid event,
 * so that sending it again once fixed is not taken for a duplicate.
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
  }
  await recordEngineEvent(ctx, {
    instanceId: instance._id,
    eventType: envelope.data?.type ?? envelope.type ?? "",
    // Unescaped, as the engine sent it, so the event can be re-fired.
    payload: JSON.stringify(envelope.data ?? null),
    envelopeId: envelopeId ?? undefined,
    engineEventTime: typeof envelope.time === "string" ? envelope.time : undefined,
  });
  const outcome = await applyEngineEvent(ctx, instance, envelope);
  if (envelopeId !== null && outcome.kind !== "invalid") {
    await ctx.db.insert("engineEventReceipts", { instanceId: instance._id, envelopeId, receivedAt: Date.now() });
  }
  return outcome;
}

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

function toBatchResult(queueId: string, outcome: ReceivedEventOutcome): BatchEventResult {
  switch (outcome.kind) {
    case "applied":
    case "duplicate":
    case "ignored":
      return { queueId, outcome: outcome.kind };
    case "invalid":
      return { queueId, outcome: "rejected", reason: outcome.reason };
  }
}

/**
 * One batch from the maintenance event queue, in queue order, as one
 * transaction: every event of it applies or none does, so the relay can
 * resend or split a failed batch without anything having been half-applied.
 * Each event is attributed to the instance the queue names, and only applies
 * while that instance's events token hash still matches the queue's.
 * `envelopeJson` is raw JSON for the same reason as applyFromWebhook's body.
 */
export const applyBatch = internalMutation({
  args: {
    events: v.array(
      v.object({ queueId: v.string(), instanceId: v.string(), tokenHash: v.string(), envelopeJson: v.string() })
    ),
  },
  handler: async (ctx, { events }): Promise<BatchEventResult[]> => {
    const instances = new Map<string, Doc<"instances"> | null>();
    const results: BatchEventResult[] = [];
    for (const event of events) {
      let instance = instances.get(event.instanceId);
      if (instance === undefined) {
        const id = ctx.db.normalizeId("instances", event.instanceId);
        instance = id === null ? null : await ctx.db.get(id);
        instances.set(event.instanceId, instance);
        if (instance) {
          await recordEngineActivityIfDue(ctx, instance);
        }
      }
      if (!instance) {
        results.push({ queueId: event.queueId, outcome: "rejected", reason: REJECTION_REASONS.unknownInstance });
        continue;
      }
      if (instance.eventsTokenHash !== event.tokenHash) {
        results.push({ queueId: event.queueId, outcome: "rejected", reason: REJECTION_REASONS.staleToken });
        continue;
      }
      const envelope = JSON.parse(event.envelopeJson) as CallbackEnvelope;
      results.push(toBatchResult(event.queueId, await receiveEngineEvent(ctx, instance, envelope)));
    }
    return results;
  },
});
