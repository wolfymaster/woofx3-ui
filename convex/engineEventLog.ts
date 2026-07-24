import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type QueryCtx, query } from "./_generated/server";

// Audit trail of every engine webhook event received (source: "webhook",
// written by convex/http.ts's POST /api/webhooks/woofx3 handler) plus every
// manual re-fire of a logged event from the Debug page (source: "retrigger").
// See convex/schema.ts's engineEventLog table doc for the payload contract.

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

export const record = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.optional(v.string()),
    eventType: v.string(),
    payload: v.string(),
    envelopeId: v.optional(v.string()),
    engineEventTime: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("engineEventLog", {
      ...args,
      source: "webhook",
      receivedAt: Date.now(),
    });
  },
});

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

export const list = query({
  args: {
    instanceId: v.id("instances"),
    eventType: v.optional(v.string()),
  },
  handler: async (ctx, { instanceId, eventType }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }

    const membership = await membershipFor(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }

    if (eventType) {
      return ctx.db
        .query("engineEventLog")
        .withIndex("by_instance_type_received_at", (q) => q.eq("instanceId", instanceId).eq("eventType", eventType))
        .order("desc")
        .take(200);
    }

    return ctx.db
      .query("engineEventLog")
      .withIndex("by_instance_received_at", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(200);
  },
});

/**
 * Re-fire a logged event's (eventType, payload) at the engine via the same
 * triggerEvent RPC the Debug page's manual "Fire" buttons already use (see
 * debug.ts::fireTrigger) — there is no engine-side "replay this exact
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
 * Deletes rows older than RETENTION_MS. Runs on a daily cron (see crons.ts) —
 * mirrors engineSyncInternal.cleanupOldRuns.
 */
export const cleanupOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - RETENTION_MS;
    const old = await ctx.db
      .query("engineEventLog")
      .withIndex("by_received_at", (q) => q.lt("receivedAt", cutoff))
      .take(200);
    for (const row of old) {
      await ctx.db.delete(row._id);
    }
    return old.length;
  },
});
