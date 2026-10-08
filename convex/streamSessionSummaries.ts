import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx, query } from "./_generated/server";
import {
  isSummaryInProgress,
  parseSessionSummary,
  planOpenSnapshotWrite,
  planSummaryWrite,
  type SummaryWrite,
  summaryColumns,
} from "./lib/sessionSummary";
import { isInstanceMember } from "./lib/teamAccess";
import { logger } from "./logger";

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 50;

async function storeSummary(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  data: unknown,
  plan: (stored: Doc<"streamSessionSummaries"> | null, incomingGeneratedAtMs: number) => SummaryWrite
) {
  const parsed = parseSessionSummary(data);
  if (!parsed.ok) {
    return { outcome: "invalid" as const, reason: parsed.reason };
  }
  const summary = parsed.summary;
  if (summary.body === null) {
    logger.warn("session summary: keeping a schemaVersion this deployment does not interpret", {
      instanceId,
      sessionId: summary.sessionId,
      schemaVersion: summary.schemaVersion,
    });
  }
  const columns = summaryColumns(summary, JSON.stringify(data));

  const existing = await ctx.db
    .query("streamSessionSummaries")
    .withIndex("by_instance_session", (q) => q.eq("instanceId", instanceId).eq("sessionId", summary.sessionId))
    .unique();

  if (plan(existing, summary.generatedAtMs) === "stale") {
    return { outcome: "stale" as const };
  }
  const row = { instanceId, ...columns, receivedAt: Date.now() };
  if (existing === null) {
    await ctx.db.insert("streamSessionSummaries", row);
    return { outcome: "insert" as const };
  }
  await ctx.db.replace(existing._id, row);
  return { outcome: "replace" as const };
}

/**
 * Rows as the recap pages read them, each with whether its stream is live now.
 * Derived on every read rather than stored, so a session the engine still holds
 * open across an offline gap reads as finished the moment the stream goes down
 * and as in progress again if the next broadcast continues it, with nothing to
 * fall out of step.
 */
async function withInProgress(ctx: QueryCtx, instanceId: Id<"instances">, rows: Doc<"streamSessionSummaries">[]) {
  const liveState = await ctx.db
    .query("instanceLiveState")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .first();
  return rows.map((row) => ({ ...row, inProgress: isSummaryInProgress(row, liveState) }));
}

/**
 * Stores one SESSION_SUMMARY delivery. Idempotent on (instance, session): a
 * repeat with the same or an older generatedAt leaves the stored row alone, so
 * redeliveries and out-of-order arrivals are harmless.
 */
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    data: v.any(),
  },
  handler: async (ctx, { instanceId, data }) => storeSummary(ctx, instanceId, data, planSummaryWrite),
});

/**
 * Stores a snapshot of the engine's open session that the UI took itself
 * (streamRecap.refreshOpenSession), so a stream in progress has a recap before
 * the engine summarises it at its end. Never replaces a closed session's row.
 */
export const upsertOpenSnapshot = internalMutation({
  args: {
    instanceId: v.id("instances"),
    data: v.any(),
  },
  handler: async (ctx, { instanceId, data }) => storeSummary(ctx, instanceId, data, planOpenSnapshotWrite),
});

/** The instance's newest stored session, for deciding whether a fresh snapshot is needed. */
export const newestInternal = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("streamSessionSummaries")
      .withIndex("by_instance_started", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .first();
  },
});

/** The instance's most recent summarised sessions, newest session first. */
export const listRecent = query({
  args: {
    instanceId: v.id("instances"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, limit }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return [];
    }
    const take = Math.min(Math.max(Math.floor(limit ?? DEFAULT_RECENT_LIMIT), 1), MAX_RECENT_LIMIT);
    const rows = await ctx.db
      .query("streamSessionSummaries")
      .withIndex("by_instance_started", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(take);
    return withInProgress(ctx, instanceId, rows);
  },
});

/** One summarised session, or null when none is stored for it. */
export const get = query({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
  },
  handler: async (ctx, { instanceId, sessionId }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    const row = await ctx.db
      .query("streamSessionSummaries")
      .withIndex("by_instance_session", (q) => q.eq("instanceId", instanceId).eq("sessionId", sessionId))
      .unique();
    if (row === null) {
      return null;
    }
    const [withStatus] = await withInProgress(ctx, instanceId, [row]);
    return withStatus;
  },
});

/** The same row as `get`, for actions that have already checked membership. */
export const getInternal = internalQuery({
  args: {
    instanceId: v.id("instances"),
    sessionId: v.string(),
  },
  handler: async (ctx, { instanceId, sessionId }) => {
    return ctx.db
      .query("streamSessionSummaries")
      .withIndex("by_instance_session", (q) => q.eq("instanceId", instanceId).eq("sessionId", sessionId))
      .unique();
  },
});
