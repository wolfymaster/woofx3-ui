import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";
import { isInstanceMember } from "./lib/teamAccess";

/** Every mirrored value on the instance, keyed by canonical id. */
export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return {};
    }
    const rows = await ctx.db
      .query("resourceValues")
      .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId))
      .collect();
    const values: Record<string, unknown> = {};
    for (const row of rows) {
      values[row.canonicalId] = row.value;
    }
    return values;
  },
});

async function upsertValue(ctx: MutationCtx, instanceId: Id<"instances">, canonicalId: string, value: unknown) {
  const existing = await ctx.db
    .query("resourceValues")
    .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId).eq("canonicalId", canonicalId))
    .first();
  const row = { instanceId, canonicalId, value: value ?? null, updatedAt: Date.now() };
  if (existing) {
    await ctx.db.patch(existing._id, row);
  } else {
    await ctx.db.insert("resourceValues", row);
  }
}

/** One value, from the storage-changed webhook. */
export const upsert = internalMutation({
  args: { instanceId: v.id("instances"), canonicalId: v.string(), value: v.any() },
  handler: async (ctx, { instanceId, canonicalId, value }) => {
    await upsertValue(ctx, instanceId, canonicalId, value);
  },
});

/** Many values at once, from a read of the engine's current values. */
export const upsertMany = internalMutation({
  args: { instanceId: v.id("instances"), values: v.record(v.string(), v.any()) },
  handler: async (ctx, { instanceId, values }) => {
    for (const [canonicalId, value] of Object.entries(values)) {
      await upsertValue(ctx, instanceId, canonicalId, value);
    }
  },
});
