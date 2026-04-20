import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Record a pending engine round-trip so the webhook handler can correlate
 * the eventual echo back to the originating action call.
 */
export const insertPending = internalMutation({
  args: {
    correlationKey: v.string(),
    instanceId: v.id("instances"),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pendingWorkflowOperations", args);
  },
});

/**
 * Look up the webhook-confirmed outcome for a correlationKey. Used by the
 * action-side polling loop to detect when the engine has acknowledged a
 * mutation.
 */
export const findCompletion = internalQuery({
  args: { correlationKey: v.string() },
  handler: async (ctx, { correlationKey }) => {
    return ctx.db
      .query("completedWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
  },
});

/**
 * Resolve a pending operation when its webhook echo arrives: delete the
 * pending row (if still present) and record the completion. Works for
 * create/update events.
 */
export const resolveCorrelation = internalMutation({
  args: {
    correlationKey: v.string(),
    engineWorkflowId: v.string(),
    op: v.union(v.literal("create"), v.literal("update"), v.literal("delete")),
  },
  handler: async (ctx, { correlationKey, engineWorkflowId, op }) => {
    const pending = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (pending) {
      await ctx.db.delete(pending._id);
    }
    await ctx.db.insert("completedWorkflowOperations", {
      correlationKey,
      engineWorkflowId,
      op,
      completedAt: Date.now(),
    });
  },
});

/**
 * Delete a completion record. Intended for action-side cleanup once the
 * engineWorkflowId has been observed, to avoid unbounded growth.
 */
export const clearCompletion = internalMutation({
  args: { correlationKey: v.string() },
  handler: async (ctx, { correlationKey }) => {
    const row = await ctx.db
      .query("completedWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (row) {
      await ctx.db.delete(row._id);
    }
  },
});

/**
 * Mirror a workflow row from a webhook snapshot. Upsert keyed on
 * (instanceId, engineWorkflowId); idempotent for duplicate deliveries.
 */
export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    applicationId: v.string(),
    engineWorkflowId: v.string(),
    definition: v.any(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, { instanceId, applicationId, engineWorkflowId, definition, isEnabled }) => {
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        definition,
        isEnabled,
        applicationId,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("workflows", {
      instanceId,
      applicationId,
      engineWorkflowId,
      definition,
      isEnabled,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Delete a mirrored workflow row in response to a workflow.deleted webhook.
 */
export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }) => {
    const row = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    if (row) {
      await ctx.db.delete(row._id);
    }
  },
});

/**
 * Remove expired pending operations. Scheduled via the crons module so
 * pending rows that never received a webhook echo don't accumulate.
 */
export const sweepExpiredPending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
      .take(100);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
  },
});

/**
 * Resolve a pending delete op. Separate from resolveCorrelation because
 * the delete webhook carries workflowId directly (no nested snapshot).
 */
export const resolveCorrelationForDelete = internalMutation({
  args: { correlationKey: v.string(), engineWorkflowId: v.string() },
  handler: async (ctx, { correlationKey, engineWorkflowId }) => {
    const pending = await ctx.db
      .query("pendingWorkflowOperations")
      .withIndex("by_correlation", (q) => q.eq("correlationKey", correlationKey))
      .first();
    if (pending) {
      await ctx.db.delete(pending._id);
    }
    await ctx.db.insert("completedWorkflowOperations", {
      correlationKey,
      engineWorkflowId,
      op: "delete",
      completedAt: Date.now(),
    });
  },
});
