import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getInstanceMembership } from "./lib/teamAccess";

/**
 * List all workflows mirrored into Convex for an instance. Rows arrive via
 * webhook upsert after engine round-trips; nodes/edges are an optional
 * browser-computed projection cached back via `updateProjection`.
 */
export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<Doc<"workflows">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return [];
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return [];
    }
    return ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .take(100);
  },
});

/**
 * Fetch a single workflow row by engineWorkflowId. Returns null when the
 * caller has no membership, the instance does not exist, or the row has
 * not been mirrored yet (e.g. webhook has not landed).
 */
export const getByEngineId = query({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
  },
  handler: async (ctx, { instanceId, engineWorkflowId }): Promise<Doc<"workflows"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      return null;
    }
    return ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
  },
});

/**
 * Cache a ReactFlow projection (nodes/edges) computed in the browser from
 * the canonical WorkflowDefinition. Best-effort: if the row does not yet
 * exist (webhook hasn't landed) we simply no-op.
 */
export const updateProjection = mutation({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.string(),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
  },
  handler: async (ctx, { instanceId, engineWorkflowId, nodes, edges }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    const membership = await getInstanceMembership(ctx, instanceId, userId);
    if (!membership) {
      throw new Error("Not authorized");
    }

    const row = await ctx.db
      .query("workflows")
      .withIndex("by_engine_id", (q) => q.eq("instanceId", instanceId).eq("engineWorkflowId", engineWorkflowId))
      .first();
    if (!row) {
      return null;
    }
    await ctx.db.patch(row._id, {
      nodes,
      edges,
      projectionUpdatedAt: Date.now(),
    });
    return null;
  },
});
