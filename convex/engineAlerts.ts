import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

type EngineAlertStatus =
  | "sent"
  | "playing"
  | "completed"
  | "failed"
  | "replayed"
  | "timed_out"
  | "skipped"
  | "pending"
  | "dispatched";

const STATUS_VALIDATOR = v.union(
  v.literal("sent"),
  v.literal("playing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("replayed"),
  v.literal("timed_out"),
  v.literal("skipped"),
  v.literal("pending"),
  v.literal("dispatched")
);

const KNOWN_STATUSES: ReadonlySet<EngineAlertStatus> = new Set<EngineAlertStatus>([
  "sent",
  "playing",
  "completed",
  "failed",
  "replayed",
  "timed_out",
  "skipped",
  "pending",
  "dispatched",
]);

function normaliseStatus(raw: string): EngineAlertStatus {
  if (KNOWN_STATUSES.has(raw as EngineAlertStatus)) {
    return raw as EngineAlertStatus;
  }
  // Unknown lifecycle value from a future engine version — fall back to "sent"
  // so the row is still queryable. Convex would reject anything outside the
  // union; we deliberately coerce here rather than drop the alert.
  return "sent";
}

const snapshotValidator = v.object({
  id: v.string(),
  applicationId: v.string(),
  payload: v.string(),
  workflowId: v.optional(v.string()),
  sourceEventId: v.optional(v.string()),
  status: v.string(),
  envelopeId: v.optional(v.string()),
  dispatchedAt: v.optional(v.string()),
  playedAt: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

/**
 * Whether the signed-in user may read this instance's alerts.
 *
 * An alert envelope carries the resolved text of what played -- viewer names,
 * chat messages, amounts -- so it is gated exactly like the workflows that
 * produced it.
 */
async function canRead(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  return (await getInstanceMembership(ctx, instanceId, userId)) !== null;
}

export const listForInstance = query({
  args: {
    instanceId: v.id("instances"),
    limit: v.optional(v.number()),
    status: v.optional(STATUS_VALIDATOR),
  },
  handler: async (ctx, { instanceId, limit, status }) => {
    if (!(await canRead(ctx, instanceId))) {
      return [];
    }
    const take = Math.min(Math.max(limit ?? 50, 1), 500);
    if (status) {
      return ctx.db
        .query("engineAlerts")
        .withIndex("by_instance_status", (q) => q.eq("instanceId", instanceId).eq("status", status))
        .order("desc")
        .take(take);
    }
    return ctx.db
      .query("engineAlerts")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(take);
  },
});

const HOUR_MS = 60 * 60 * 1000;

/** Hours of history the dashboard's counters and chart describe by default. */
const OVERVIEW_HOURS_DEFAULT = 24;
const OVERVIEW_HOURS_MAX = 24 * 7;

/**
 * Most alerts one overview counts.
 *
 * Counting a status means reading the whole row, payload and all, because
 * Convex has no projection -- so an unbounded window would make the busiest
 * instance pay the most for a page of tiles. Past this the counts describe the
 * newest alerts of the window and `truncated` says so.
 */
const OVERVIEW_MAX_ROWS = 300;

/** What a lifecycle status counts as on the dashboard. */
type AlertOutcome = "completed" | "failed" | "inFlight" | "skipped" | "replayed";

/**
 * An alert's outcome for counting purposes.
 *
 * `replayed` is neither a success nor a failure: the operator superseded that
 * row, and the re-fire is its own row, so counting it either way would report
 * one alert twice.
 */
function outcomeOf(status: EngineAlertStatus): AlertOutcome {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
    case "timed_out":
      return "failed";
    case "sent":
    case "pending":
    case "dispatched":
    case "playing":
      return "inFlight";
    case "skipped":
      return "skipped";
    case "replayed":
      return "replayed";
  }
}

/**
 * How alerts have gone lately: totals by outcome, and one bucket per hour.
 *
 * Both the window and the buckets are measured on `_creationTime` -- when the
 * webhook landed -- rather than on the engine's own `engineCreatedAt`. One
 * clock means a row can never fall outside the window that selected it. The
 * feed still shows engine time, which is the one a streamer recognises.
 */
export const overview = query({
  args: {
    instanceId: v.id("instances"),
    windowHours: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, windowHours }) => {
    if (!(await canRead(ctx, instanceId))) {
      return null;
    }

    const hours = Math.min(Math.max(Math.round(windowHours ?? OVERVIEW_HOURS_DEFAULT), 1), OVERVIEW_HOURS_MAX);
    // Aligned to the hour so every bucket but the last covers a whole one, and
    // the chart's labels are wall-clock hours rather than offsets from now.
    const since = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS;

    const rows = await ctx.db
      .query("engineAlerts")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId).gte("_creationTime", since))
      .order("desc")
      .take(OVERVIEW_MAX_ROWS);

    const buckets = Array.from({ length: hours }, (_, index) => ({
      start: since + index * HOUR_MS,
      total: 0,
      failed: 0,
    }));
    const totals = { total: 0, completed: 0, failed: 0, inFlight: 0, skipped: 0, replayed: 0 };

    for (const row of rows) {
      const outcome = outcomeOf(row.status);
      totals.total += 1;
      totals[outcome] += 1;

      const index = Math.floor((row._creationTime - since) / HOUR_MS);
      if (index >= 0 && index < buckets.length) {
        buckets[index].total += 1;
        if (outcome === "failed") {
          buckets[index].failed += 1;
        }
      }
    }

    return {
      hours,
      since,
      bucketMs: HOUR_MS,
      truncated: rows.length === OVERVIEW_MAX_ROWS,
      totals,
      buckets,
    };
  },
});

export const recordFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshot: snapshotValidator,
  },
  handler: async (ctx, { instanceId, snapshot }) => {
    const row = {
      instanceId,
      applicationId: snapshot.applicationId,
      engineAlertId: snapshot.id,
      payload: snapshot.payload,
      workflowId: snapshot.workflowId || undefined,
      sourceEventId: snapshot.sourceEventId || undefined,
      status: normaliseStatus(snapshot.status),
      envelopeId: snapshot.envelopeId || undefined,
      dispatchedAt: snapshot.dispatchedAt,
      playedAt: snapshot.playedAt,
      completedAt: snapshot.completedAt,
      error: snapshot.error,
      engineCreatedAt: snapshot.createdAt,
      engineUpdatedAt: snapshot.updatedAt,
      createdAt: Date.now(),
    };

    const existing = await ctx.db
      .query("engineAlerts")
      .withIndex("by_engine_id", (q) => q.eq("engineAlertId", snapshot.id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("engineAlerts", row);
    }
  },
});

export const updateFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshot: snapshotValidator,
  },
  handler: async (ctx, { instanceId, snapshot }) => {
    const existing = await ctx.db
      .query("engineAlerts")
      .withIndex("by_engine_id", (q) => q.eq("engineAlertId", snapshot.id))
      .first();

    const patch = {
      status: normaliseStatus(snapshot.status),
      payload: snapshot.payload,
      workflowId: snapshot.workflowId || undefined,
      sourceEventId: snapshot.sourceEventId || undefined,
      envelopeId: snapshot.envelopeId || undefined,
      dispatchedAt: snapshot.dispatchedAt,
      playedAt: snapshot.playedAt,
      completedAt: snapshot.completedAt,
      error: snapshot.error,
      engineUpdatedAt: snapshot.updatedAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      // Lifecycle event arrived before the recorded event — insert the row
      // with the data we have so the row exists when subsequent events land.
      await ctx.db.insert("engineAlerts", {
        instanceId,
        applicationId: snapshot.applicationId,
        engineAlertId: snapshot.id,
        engineCreatedAt: snapshot.createdAt,
        createdAt: Date.now(),
        ...patch,
      });
    }
  },
});
