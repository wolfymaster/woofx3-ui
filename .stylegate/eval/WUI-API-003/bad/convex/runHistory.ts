import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireInstanceRole } from "./lib/instanceAccess";

export const runById = query({
  args: { instanceId: v.id("instances"), engineRunId: v.string() },
  handler: async (ctx, { instanceId, engineRunId }) => {
    await requireInstanceRole(ctx, instanceId);
    const run = await ctx.db
      .query("workflowRuns")
      .withIndex("by_engine_id", (q) => q.eq("engineRunId", engineRunId))
      .first();
    return run ? { status: run.status, startedAt: run.startedAt, workflowName: run.workflowName } : null;
  },
});

export const runsForUser = query({
  args: { userId: v.id("users"), instanceId: v.id("instances") },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("instanceMembers")
      .withIndex("by_instance_user", (q) => q.eq("instanceId", args.instanceId).eq("userId", args.userId))
      .first();
    if (!membership) {
      return [];
    }
    return ctx.db
      .query("workflowRuns")
      .withIndex("by_instance", (q) => q.eq("instanceId", args.instanceId as Id<"instances">))
      .take(20);
  },
});
