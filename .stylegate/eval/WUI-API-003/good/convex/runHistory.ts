import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

export const runById = query({
  args: { instanceId: v.id("instances"), engineRunId: v.string() },
  handler: async (ctx, { instanceId, engineRunId }) => {
    await requireInstanceRole(ctx, instanceId);
    const run = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", engineRunId))
      .first();
    // Engine run ids are guessable enough to paste; a row of another instance is never returned.
    if (!run || run.instanceId !== instanceId) {
      return null;
    }
    return { status: run.status, startedAt: run.startedAt, workflowName: run.workflowName };
  },
});

export const recordRunFromWebhook = internalMutation({
  args: { instanceId: v.id("instances"), engineRunId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", args.engineRunId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status: args.status });
      return;
    }
    await ctx.db.insert("workflowRuns", { instanceId: args.instanceId, engineRunId: args.engineRunId, status: args.status });
  },
});
