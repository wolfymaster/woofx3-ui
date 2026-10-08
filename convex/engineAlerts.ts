import { getAuthUserId } from "@convex-dev/auth/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import {
  ALERT_IN_FLIGHT_STALE_MS,
  acceptsTransition,
  normaliseStatus,
  outcomeOf,
  UNSETTLED_STATUSES,
} from "./lib/engineAlertLifecycle";
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
  version: v.optional(v.number()),
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
 * Whether an alert is still on its way comes from the row alone: the staleness
 * sweep (`markStaleAlerts`) marks an alert unconfirmed on Convex's clock, so no
 * caller's clock takes part in it.
 *
 * Only the window needs a time, and a query cannot read the clock -- it is not
 * re-run as time passes -- so `hourStart` comes from the caller: the start of
 * its current hour. Hour-aligned so the arguments change once an hour rather
 * than with every tick, and so every bucket but the last covers a whole hour
 * and the chart's labels are wall-clock hours. A skewed caller clock can only
 * shift which hours the window covers.
 *
 * Both the window and the buckets are measured on `_creationTime` -- when the
 * webhook landed -- rather than on the engine's own `engineCreatedAt`. One
 * clock means a row can never fall outside the window that selected it. The
 * feed still shows engine time, which is the one a streamer recognises.
 */
export const overview = query({
  args: {
    instanceId: v.id("instances"),
    hourStart: v.number(),
    windowHours: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, hourStart, windowHours }) => {
    if (!Number.isFinite(hourStart) || hourStart % HOUR_MS !== 0) {
      throw new Error("overview: hourStart must be an epoch-milliseconds time on the hour");
    }
    if (!(await canRead(ctx, instanceId))) {
      return null;
    }

    const hours = Math.min(Math.max(Math.round(windowHours ?? OVERVIEW_HOURS_DEFAULT), 1), OVERVIEW_HOURS_MAX);
    const since = hourStart - (hours - 1) * HOUR_MS;

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
    };

    for (const row of rows) {
      const outcome = outcomeOf(row);
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
    engineVersion: snapshot.version,
  };
  const now = Date.now();

  // Nothing should write a second row for one alert, but if one exists the
  // callback still has to land: throwing would fail every retry of it forever.
  // The oldest row is the one kept up to date, and the index order makes that
  // the same row on every delivery.
  const matches = await ctx.db
    .query("engineAlerts")
    .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineAlertId", snapshot.id))
    .take(2);
  if (matches.length > 1) {
    console.warn(`engineAlerts: instance ${instanceId} has more than one row for alert ${snapshot.id}`);
  }
  const existing = matches[0];
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
  // Real progress clears the sweep's unconfirmed mark, so an alert the sweep
  // gave up on still lands when the engine does report it.
  const progressed =
    existing.status !== lifecycle.status ||
    existing.engineUpdatedAt !== lifecycle.engineUpdatedAt ||
    existing.engineVersion !== lifecycle.engineVersion;
  await ctx.db.patch(
    existing._id,
    progressed ? { ...lifecycle, progressedAt: now, unconfirmedAt: undefined } : lifecycle
  );
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

/** Most rows one sweep marks before handing the rest to a fresh transaction. */
const STALE_SWEEP_BATCH = 200;

/**
 * Mark every unsettled alert that has not moved for `ALERT_IN_FLIGHT_STALE_MS`
 * as unconfirmed, by setting `unconfirmedAt`.
 *
 * Run by a cron rather than worked out when reading, because a query cannot
 * read the clock and the viewer's clock is not Convex's. The index holds only
 * unmarked rows at the front, so each run reads exactly the rows that are due.
 * A row the mirror has no `progressedAt` for is measured from its creation,
 * the first progress the mirror saw of it.
 */
export const markStaleAlerts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - ALERT_IN_FLIGHT_STALE_MS;
    let remaining = STALE_SWEEP_BATCH;
    for (const status of UNSETTLED_STATUSES) {
      const measured = await ctx.db
        .query("engineAlerts")
        .withIndex("by_unconfirmedAt_and_status_and_progressedAt", (q) =>
          q.eq("unconfirmedAt", undefined).eq("status", status).gte("progressedAt", 0).lt("progressedAt", cutoff)
        )
        .take(remaining);
      remaining -= measured.length;
      const unmeasured =
        remaining > 0
          ? await ctx.db
              .query("engineAlerts")
              .withIndex("by_unconfirmedAt_and_status_and_progressedAt", (q) =>
                q
                  .eq("unconfirmedAt", undefined)
                  .eq("status", status)
                  .eq("progressedAt", undefined)
                  .lt("_creationTime", cutoff)
              )
              .take(remaining)
          : [];
      remaining -= unmeasured.length;
      for (const row of [...measured, ...unmeasured]) {
        await ctx.db.patch(row._id, { unconfirmedAt: now });
      }
      if (remaining === 0) {
        await ctx.scheduler.runAfter(0, internal.engineAlerts.markStaleAlerts, {});
        return;
      }
    }
  },
});
