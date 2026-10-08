import { getAuthUserId } from "@convex-dev/auth/server";
import { type Infer, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import { acceptsTransition, lastProgressAt, normaliseStatus, outcomeOf } from "./lib/engineAlertLifecycle";
import { getInstanceMembership } from "./lib/teamAccess";

const STATUS_VALIDATOR = v.union(
  v.literal("sent"),
  v.literal("playing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("replayed"),
  v.literal("timed_out"),
  v.literal("skipped"),
  v.literal("pending"),
  v.literal("dispatched"),
  v.literal("unknown")
);

const snapshotValidator = v.object({
  id: v.string(),
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

type AlertSnapshot = Infer<typeof snapshotValidator>;

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

/**
 * How alerts have gone lately: totals by outcome, and one bucket per hour.
 *
 * `now` comes from the caller because a query is not re-run as time passes:
 * read from the clock here, the window and the in-flight staleness bound would
 * stay where they were when the page opened. The client sends its ticking clock
 * (`useMinuteClock`), the same one it draws the feed with, so a row and the
 * tile counting it age together.
 *
 * Both the window and the buckets are measured on `_creationTime` -- when the
 * webhook landed -- rather than on the engine's own `engineCreatedAt`. One
 * clock means a row can never fall outside the window that selected it. The
 * feed still shows engine time, which is the one a streamer recognises.
 */
export const overview = query({
  args: {
    instanceId: v.id("instances"),
    now: v.number(),
    windowHours: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, now, windowHours }) => {
    if (!Number.isFinite(now)) {
      throw new Error("overview: now must be a finite epoch-milliseconds time");
    }
    if (!(await canRead(ctx, instanceId))) {
      return null;
    }

    const hours = Math.min(Math.max(Math.round(windowHours ?? OVERVIEW_HOURS_DEFAULT), 1), OVERVIEW_HOURS_MAX);
    // Aligned to the hour so every bucket but the last covers a whole one, and
    // the chart's labels are wall-clock hours rather than offsets from now.
    const since = Math.floor(now / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS;

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
    const totals = {
      total: 0,
      completed: 0,
      failed: 0,
      inFlight: 0,
      unconfirmed: 0,
      skipped: 0,
      replayed: 0,
      unknown: 0,
    };

    for (const row of rows) {
      const outcome = outcomeOf(row.status, lastProgressAt(row), now);
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

/**
 * Merge one engine snapshot into the instance's mirror of that alert.
 *
 * The lookup is scoped to the instance the callback authenticated as, so an
 * engine can only ever touch its own rows, and a row never changes instance.
 * `alert.recorded` and the lifecycle callbacks are retried independently and
 * may arrive in any order, so either one may be the first to create the row,
 * and `acceptsTransition` drops a snapshot older than the row: it would also
 * unset lifecycle timestamps the row already holds.
 */
async function mergeSnapshot(ctx: MutationCtx, instanceId: Id<"instances">, snapshot: AlertSnapshot): Promise<void> {
  const status = normaliseStatus(snapshot.status);
  if (status === "unknown") {
    console.warn(`engineAlerts: alert ${snapshot.id} has unrecognised status "${snapshot.status}"`);
  }
  const lifecycle = {
    status,
    engineStatus: status === "unknown" ? snapshot.status : undefined,
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
  const now = Date.now();

  const existing = await ctx.db
    .query("engineAlerts")
    .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineAlertId", snapshot.id))
    .unique();
  if (!existing) {
    await ctx.db.insert("engineAlerts", {
      instanceId,
      engineAlertId: snapshot.id,
      engineCreatedAt: snapshot.createdAt,
      createdAt: now,
      progressedAt: now,
      ...lifecycle,
    });
    return;
  }
  if (!acceptsTransition(existing, lifecycle)) {
    return;
  }
  // A redelivery of the snapshot already held is not progress; counting it as
  // such would keep an alert the engine lost track of in flight indefinitely.
  const progressed = existing.status !== lifecycle.status || existing.engineUpdatedAt !== lifecycle.engineUpdatedAt;
  await ctx.db.patch(existing._id, progressed ? { ...lifecycle, progressedAt: now } : lifecycle);
}

export const recordFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshot: snapshotValidator,
  },
  handler: async (ctx, { instanceId, snapshot }) => {
    await mergeSnapshot(ctx, instanceId, snapshot);
  },
});

export const updateFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    snapshot: snapshotValidator,
  },
  handler: async (ctx, { instanceId, snapshot }) => {
    await mergeSnapshot(ctx, instanceId, snapshot);
  },
});
