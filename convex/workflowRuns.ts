import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const RUN_LIMIT_DEFAULT = 50;
const RUN_LIMIT_MAX = 200;

const runSnapshot = v.object({
  id: v.string(),
  workflowId: v.string(),
  applicationId: v.string(),
  status: v.string(),
  triggeredBy: v.optional(v.string()),
  triggerEvent: v.optional(v.string()),
  error: v.optional(v.string()),
  startedAt: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const stepSnapshot = v.object({
  id: v.string(),
  executionId: v.string(),
  applicationId: v.string(),
  taskId: v.string(),
  name: v.optional(v.string()),
  status: v.string(),
  attempt: v.number(),
  stepIndex: v.number(),
  inputs: v.optional(v.string()),
  outputs: v.optional(v.string()),
  error: v.optional(v.string()),
  startedAt: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  durationMs: v.optional(v.number()),
  createdAt: v.string(),
  updatedAt: v.string(),
});

/**
 * Runs for one instance, newest first.
 *
 * Deliberately does not join steps: the list shows one line per run, and
 * fetching every step of every run to render a summary would read the whole
 * history to display a page of it. The timeline loads steps for the one run
 * it is showing.
 */
export const listForInstance = query({
  args: {
    instanceId: v.id("instances"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { instanceId, limit }) => {
    const take = Math.min(Math.max(limit ?? RUN_LIMIT_DEFAULT, 1), RUN_LIMIT_MAX);
    return ctx.db
      .query("workflowRuns")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(take);
  },
});

/** One run with its steps in the order the engine executed them. */
export const runWithSteps = query({
  args: {
    instanceId: v.id("instances"),
    engineRunId: v.string(),
  },
  handler: async (ctx, { instanceId, engineRunId }) => {
    const run = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", engineRunId))
      .first();
    // Scoped after the lookup rather than in the index: engine run ids are
    // UUIDs, but a row belonging to another instance must never be returned
    // just because its id was guessed or pasted.
    if (!run || run.instanceId !== instanceId) {
      return null;
    }

    const steps = await ctx.db
      .query("workflowRunSteps")
      .withIndex("by_run", (q) => q.eq("runId", engineRunId))
      .collect();

    return { run, steps };
  },
});

export const recordFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    run: runSnapshot,
  },
  handler: async (ctx, { instanceId, run }) => {
    const row = {
      instanceId,
      applicationId: run.applicationId,
      engineRunId: run.id,
      workflowId: run.workflowId,
      status: run.status,
      triggeredBy: run.triggeredBy,
      triggerEvent: run.triggerEvent,
      error: run.error,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      engineCreatedAt: run.createdAt,
      engineUpdatedAt: run.updatedAt,
      createdAt: Date.now(),
    };

    const existing = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", run.id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("workflowRuns", row);
    }
  },
});

export const updateFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    run: runSnapshot,
  },
  handler: async (ctx, { instanceId, run }) => {
    const existing = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", run.id))
      .first();

    const patch = {
      status: run.status,
      error: run.error,
      completedAt: run.completedAt,
      triggeredBy: run.triggeredBy,
      triggerEvent: run.triggerEvent,
      engineUpdatedAt: run.updatedAt,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return;
    }

    // The settle arrived before the record. The outbox is at-least-once and
    // unordered, so insert what we have rather than dropping the run: a run
    // that only ever shows its outcome is better than one that vanishes.
    await ctx.db.insert("workflowRuns", {
      instanceId,
      applicationId: run.applicationId,
      engineRunId: run.id,
      workflowId: run.workflowId,
      startedAt: run.startedAt,
      engineCreatedAt: run.createdAt,
      createdAt: Date.now(),
      ...patch,
    });
  },
});

export const recordStepFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    step: stepSnapshot,
  },
  handler: async (ctx, { instanceId, step }) => {
    const row = {
      instanceId,
      applicationId: step.applicationId,
      engineStepId: step.id,
      runId: step.executionId,
      taskId: step.taskId,
      name: step.name,
      status: step.status,
      attempt: step.attempt,
      stepIndex: step.stepIndex,
      inputs: step.inputs,
      outputs: step.outputs,
      error: step.error,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      durationMs: step.durationMs,
      engineCreatedAt: step.createdAt,
      engineUpdatedAt: step.updatedAt,
      createdAt: Date.now(),
    };

    // Keyed on the attempt, not the engine's row id: a step is reported when
    // it starts and again when it settles, and the engine mints a fresh id
    // each time. Matching on (run, task, attempt) collapses them into the one
    // row the Postgres unique index also enforces.
    const existing = await ctx.db
      .query("workflowRunSteps")
      .withIndex("by_attempt", (q) =>
        q.eq("runId", step.executionId).eq("taskId", step.taskId).eq("attempt", step.attempt)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("workflowRunSteps", row);
    }
  },
});
