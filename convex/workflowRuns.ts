import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * Milliseconds for an engine timestamp. Go marshals nanosecond precision, which
 * not every JavaScript engine parses, so the fraction is trimmed first.
 */
function engineTime(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  return Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
}

/**
 * Whether an incoming snapshot is at least as new as the stored row.
 *
 * Webhooks arrive at-least-once and in any order, so a snapshot of a run still
 * running can land after the one recording its completion. Applying it would
 * rewind the run to `running` for good. When either time cannot be read the
 * snapshot is applied: a stale row is recoverable, a dropped one is not.
 */
function isAtLeastAsNew(incoming: string, stored: string | undefined): boolean {
  const next = engineTime(incoming);
  const current = engineTime(stored);
  if (Number.isNaN(next) || Number.isNaN(current)) {
    return true;
  }
  return next >= current;
}
const runSnapshot = v.object({
  id: v.string(),
  workflowId: v.string(),
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
 * Whether the signed-in user may read this instance's history.
 *
 * Run history carries trigger events and resolved step parameters, which can
 * include viewer names and message text, so it is gated exactly like the
 * workflow definitions it describes.
 */
async function canRead(ctx: QueryCtx, instanceId: Id<"instances">): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return false;
  }
  return (await getInstanceMembership(ctx, instanceId, userId)) !== null;
}

/**
 * A workflow's display name, or undefined when the definition has not been
 * mirrored into Convex yet or carries no name. The UI falls back to the id.
 */
async function workflowName(
  ctx: QueryCtx,
  instanceId: Id<"instances">,
  engineWorkflowId: string
): Promise<string | undefined> {
  const workflow: Doc<"workflows"> | null = await ctx.db
    .query("workflows")
    .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
    .first();
  const name = (workflow?.definition as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

const RUN_ALERT_LIMIT = 50;

/** One run with its steps in the order the engine executed them, and the alerts it published. */
export const runWithSteps = query({
  args: {
    instanceId: v.id("instances"),
    engineRunId: v.string(),
  },
  handler: async (ctx, { instanceId, engineRunId }) => {
    if (!(await canRead(ctx, instanceId))) {
      return null;
    }

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

    // `workflowId` on an alert row is the execution that published it. A run
    // publishes a handful of alerts at most; the bound only guards a loop.
    const alerts = await ctx.db
      .query("engineAlerts")
      .withIndex("by_instance_workflow", (q) => q.eq("instanceId", instanceId).eq("workflowId", engineRunId))
      .take(RUN_ALERT_LIMIT);

    return {
      run: { ...run, workflowName: await workflowName(ctx, instanceId, run.workflowId) },
      steps,
      alerts: alerts.map((alert) => ({
        engineAlertId: alert.engineAlertId,
        status: alert.status,
        payload: alert.payload,
        error: alert.error,
        dispatchedAt: alert.dispatchedAt,
        playedAt: alert.playedAt,
        completedAt: alert.completedAt,
        engineCreatedAt: alert.engineCreatedAt,
      })),
    };
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
      if (isAtLeastAsNew(run.updatedAt, existing.engineUpdatedAt)) {
        await ctx.db.patch(existing._id, row);
      }
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
      if (isAtLeastAsNew(run.updatedAt, existing.engineUpdatedAt)) {
        await ctx.db.patch(existing._id, patch);
      }
      return;
    }

    // The settle arrived before the record. The outbox is at-least-once and
    // unordered, so insert what we have rather than dropping the run: a run
    // that only ever shows its outcome is better than one that vanishes.
    await ctx.db.insert("workflowRuns", {
      instanceId,
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

    // Keyed on the attempt, not the step's id: a repeated report of an attempt
    // Postgres already stored arrives carrying a different id than the one the
    // row kept. Matching on (run, task, attempt) collapses copies into the one
    // row the Postgres unique index also enforces.
    const existing = await ctx.db
      .query("workflowRunSteps")
      .withIndex("by_attempt", (q) =>
        q.eq("runId", step.executionId).eq("taskId", step.taskId).eq("attempt", step.attempt)
      )
      .first();

    if (existing) {
      if (isAtLeastAsNew(step.updatedAt, existing.engineUpdatedAt)) {
        await ctx.db.patch(existing._id, row);
      }
    } else {
      await ctx.db.insert("workflowRunSteps", row);
    }
  },
});
