import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const list = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("workflows")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
  },
});

export const create = mutation({
  args: {
    instanceId: v.id("instances"),
    engineWorkflowId: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    isEnabled: v.boolean(),
    nodes: v.array(v.any()),
    edges: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("workflows", { ...args, createdAt: now, updatedAt: now });
  },
});

export const update = mutation({
  args: {
    id: v.id("workflows"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    isEnabled: v.optional(v.boolean()),
    nodes: v.optional(v.array(v.any())),
    edges: v.optional(v.array(v.any())),
    engineWorkflowId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) patch[k] = v;
    }
    await ctx.db.patch(id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("workflows") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
