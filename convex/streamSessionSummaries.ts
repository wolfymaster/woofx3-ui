import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { parseSessionSummary, planSummaryWrite, summaryColumns } from "./lib/sessionSummary";
import { isInstanceMember } from "./lib/teamAccess";
import { logger } from "./logger";

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 50;

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
  handler: async (ctx, { instanceId, data }) => {
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

    if (planSummaryWrite(existing, summary.generatedAtMs) === "stale") {
      return { outcome: "stale" as const };
    }
    const row = { instanceId, ...columns, receivedAt: Date.now() };
    if (existing === null) {
      await ctx.db.insert("streamSessionSummaries", row);
      return { outcome: "insert" as const };
    }
    await ctx.db.replace(existing._id, row);
    return { outcome: "replace" as const };
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
    return ctx.db
      .query("streamSessionSummaries")
      .withIndex("by_instance_started", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(take);
  },
});
