import { z } from "zod";

/**
 * The batch the woofx3 maintenance relay POSTs to `/api/engine-events/batch`,
 * and the answer it reads back. Must match `src/engine-events/contract.ts` in
 * woofx3-maintenance: a field renamed on one side only stops every batch.
 */

/**
 * The most events one batch may carry. At least the relay's own upper bound
 * for ENGINE_EVENTS_MAX_BATCH_EVENTS, so any batch it is configured to send
 * is accepted.
 */
export const MAX_BATCH_EVENTS = 1000;

export const engineEventBatchSchema = z.object({
  batchId: z.string().min(1),
  events: z
    .array(
      z.object({
        queueId: z.string().regex(/^\d+$/),
        instanceId: z.string().min(1),
        tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
        envelope: z.record(z.unknown()),
      })
    )
    .min(1)
    .max(MAX_BATCH_EVENTS),
});

export type EngineEventBatch = z.infer<typeof engineEventBatchSchema>;

/**
 * `applied` and `duplicate` are acknowledged; `ignored` (a type Convex does
 * not consume) is acknowledged too; `rejected` is dead-lettered with its
 * reason, since sending it again can never succeed.
 */
export type BatchEventOutcome = "applied" | "duplicate" | "ignored" | "rejected";

export interface BatchEventResult {
  queueId: string;
  outcome: BatchEventOutcome;
  reason?: string;
}

/** 200: one result per event, in the batch's order. */
export interface EngineEventBatchResponse {
  results: BatchEventResult[];
}

/** 500 `batch_failed`: the batch's mutation threw and nothing of it was applied. */
export const BATCH_FAILED_CODE = "batch_failed";

export const REJECTION_REASONS = {
  unknownInstance: "unknown_instance",
  staleToken: "stale_token",
} as const;
