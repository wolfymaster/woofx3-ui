import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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
  v.literal("dispatched"),
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

export const listForInstance = query({
  args: {
    instanceId: v.id("instances"),
    limit: v.optional(v.number()),
    status: v.optional(STATUS_VALIDATOR),
  },
  handler: async (ctx, { instanceId, limit, status }) => {
    const take = Math.min(Math.max(limit ?? 50, 1), 500);
    if (status) {
      return ctx.db
        .query("engineAlerts")
        .withIndex("by_instance_status", (q) =>
          q.eq("instanceId", instanceId).eq("status", status),
        )
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
