import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type ObjectType, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import { logger } from "./logger";

// Audit trail of every engine webhook event received (source: "webhook",
// written by convex/http.ts's POST /api/webhooks/woofx3 handler) plus every
// manual re-fire of a logged event from the Debug page (source: "retrigger").
// See convex/schema.ts's engineEventLog table doc for the payload contract.

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Rows one cleanup pass deletes; a full batch schedules the next pass at once. */
export const EVENT_LOG_CLEANUP_BATCH = 200;
/**
 * Further passes one daily run may chain, bounding it to 100,200 rows. A
 * larger backlog waits for the next day's run.
 */
export const EVENT_LOG_CLEANUP_MAX_CHAINED_RUNS = 500;

async function membershipFor(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  userId: Id<"users">
): Promise<Doc<"instanceMembers"> | null> {
  return await ctx.db
    .query("instanceMembers")
    .withIndex("by_instance_user", (q) => q.eq("instanceId", instanceId).eq("userId", userId))
    .first();
}

const recordArgs = {
  instanceId: v.id("instances"),
  eventType: v.string(),
  payload: v.string(),
  envelopeId: v.optional(v.string()),
  engineEventTime: v.optional(v.string()),
};

export async function recordEngineEvent(ctx: MutationCtx, args: ObjectType<typeof recordArgs>) {
  await ctx.db.insert("engineEventLog", {
    ...args,
    source: "webhook",
    receivedAt: Date.now(),
  });
}

export const record = internalMutation({ args: recordArgs, handler: recordEngineEvent });

export const recordFireAttempt = internalMutation({
  args: {
    instanceId: v.id("instances"),
    eventType: v.string(),
    payload: v.string(),
    retriggerOfId: v.id("engineEventLog"),
    userId: v.id("users"),
    success: v.boolean(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("engineEventLog", {
      ...args,
      source: "retrigger",
      receivedAt: Date.now(),
    });
  },
});

/**
 * Fetch a logged event for retriggering, scoped to a caller-verified
 * membership. Returns null (rather than throwing) so the caller can surface a
 * uniform "not found" error without distinguishing "doesn't exist" from
 * "you can't see it" — defense in depth on top of fireTrigger's own check.
 */
export const getForRetrigger = internalQuery({
  args: {
    instanceId: v.id("instances"),
    logId: v.id("engineEventLog"),
    userId: v.id("users"),
  },
  handler: async (ctx, { instanceId, logId, userId }) => {
    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    const row = await ctx.db.get(logId);
    if (!row || row.instanceId !== instanceId) {
      return null;
    }
    return row;
  },
});

const eventLogSummaryValidator = v.object({
  _id: v.id("engineEventLog"),
  eventType: v.string(),
  source: v.union(v.literal("webhook"), v.literal("retrigger")),
  receivedAt: v.number(),
  payloadLength: v.number(),
});

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" };

/**
 * Pages through an instance's event log, newest first, without payloads.
 * The query is reactive, so any payload in the result would be re-sent to
 * every open Logs page whenever a new event arrives; the dialog fetches the
 * one it shows through getPayload instead.
 */
export const list = query({
  args: {
    instanceId: v.id("instances"),
    eventType: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(eventLogSummaryValidator),
  handler: async (ctx, { instanceId, eventType, paginationOpts }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return EMPTY_PAGE;
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return EMPTY_PAGE;
    }

    const ordered = eventType
      ? ctx.db
          .query("engineEventLog")
          .withIndex("by_instance_type_received_at", (q) => q.eq("instanceId", instanceId).eq("eventType", eventType))
          .order("desc")
      : ctx.db
          .query("engineEventLog")
          .withIndex("by_instance_received_at", (q) => q.eq("instanceId", instanceId))
          .order("desc");

    const result = await ordered.paginate(paginationOpts);
    return {
      page: result.page.map((row) => ({
        _id: row._id,
        eventType: row.eventType,
        source: row.source,
        receivedAt: row.receivedAt,
        payloadLength: row.payload.length,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      splitCursor: result.splitCursor,
      pageStatus: result.pageStatus,
    };
  },
});

/**
 * The raw payload JSON string of one logged event, or null when the row does
 * not exist or belongs to an instance the caller is not a member of.
 */
export const getPayload = query({
  args: {
    logId: v.id("engineEventLog"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { logId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const row = await ctx.db.get(logId);
    if (!row) {
      return null;
    }
    const membership = await membershipFor(ctx, row.instanceId, userId);
    if (!membership) {
      return null;
    }
    return row.payload;
  },
});

/**
 * Re-fire a logged event's (eventType, payload) at the engine via the generic
 * triggerEvent RPC (see debug.ts::fireTrigger) — there is no engine-side "replay this exact
 * webhook" primitive for non-alert event types, so this is the only generic
 * mechanism available.
 */
export const retrigger = action({
  args: {
    instanceId: v.id("instances"),
    logId: v.id("engineEventLog"),
  },
  handler: async (ctx, { instanceId, logId }): Promise<{ success: boolean; message: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const row = await ctx.runQuery(internal.engineEventLog.getForRetrigger, { instanceId, logId, userId });
    if (!row) {
      throw new Error("Event log entry not found");
    }

    const eventData = JSON.parse(row.payload) as Record<string, unknown>;

    try {
      const result = await ctx.runAction(api.debug.fireTrigger, {
        instanceId,
        eventType: row.eventType,
        eventData,
      });
      await ctx.runMutation(internal.engineEventLog.recordFireAttempt, {
        instanceId,
        eventType: row.eventType,
        payload: row.payload,
        retriggerOfId: logId,
        userId,
        success: true,
      });
      return result;
    } catch (err) {
      await ctx.runMutation(internal.engineEventLog.recordFireAttempt, {
        instanceId,
        eventType: row.eventType,
        payload: row.payload,
        retriggerOfId: logId,
        userId,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});

/**
 * Deletes rows older than RETENTION_MS. Runs on a daily cron (see crons.ts) and
 * continues in further passes while a batch comes back full, up to
 * `EVENT_LOG_CLEANUP_MAX_CHAINED_RUNS`, so a backlog clears without any one
 * mutation reading an unbounded set.
 */
export const cleanupOld = internalMutation({
  args: { chainedRun: v.optional(v.number()) },
  handler: async (ctx, { chainedRun = 0 }) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("engineEventLog")
      .withIndex("by_received_at", (q) => q.lt("receivedAt", cutoff))
      .take(EVENT_LOG_CLEANUP_BATCH);
    for (const row of old) {
      await ctx.db.delete(row._id);
    }
    if (old.length === EVENT_LOG_CLEANUP_BATCH) {
      if (chainedRun < EVENT_LOG_CLEANUP_MAX_CHAINED_RUNS) {
        await ctx.scheduler.runAfter(0, internal.engineEventLog.cleanupOld, { chainedRun: chainedRun + 1 });
      } else {
        logger.warn("engineEventLog.cleanupOld: chained-run cap reached; the next daily run continues", { chainedRun });
      }
    }
    return old.length;
  },
});
