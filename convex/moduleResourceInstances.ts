import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const resourceInstanceValidator = v.object({
  id: v.string(),
  moduleId: v.string(), // engine UUID — looked up to convex moduleRepository._id
  moduleName: v.string(),
  kind: v.string(),
  instanceId: v.string(), // manifest-local instance id
  displayName: v.string(),
  canonicalId: v.string(),
});

export const listForInstance = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    return ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .collect();
  },
});

export const listByKind = query({
  args: { instanceId: v.id("instances"), kind: v.string() },
  handler: async (ctx, { instanceId, kind }) => {
    return ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_instance_kind", (q) => q.eq("instanceId", instanceId).eq("kind", kind))
      .collect();
  },
});

export const getByCanonicalId = query({
  args: { canonicalId: v.string() },
  handler: async (ctx, { canonicalId }) => {
    return ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_canonical_id", (q) => q.eq("canonicalId", canonicalId))
      .first();
  },
});

export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    instance: resourceInstanceValidator,
  },
  handler: async (ctx, { instanceId, instance }) => {
    // Resolve module by name — engine emits a UUID we can't index on directly.
    const moduleRecord = await ctx.db
      .query("moduleRepository")
      .withIndex("by_name_version", (q) => q.eq("name", instance.moduleName))
      .first();

    if (!moduleRecord) {
      return;
    }

    const row = {
      instanceId,
      moduleId: moduleRecord._id,
      engineInstanceId: instance.id,
      resourceInstanceId: instance.instanceId,
      moduleName: instance.moduleName,
      kind: instance.kind,
      displayName: instance.displayName,
      canonicalId: instance.canonicalId,
    };

    const existing = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_canonical_id", (q) => q.eq("canonicalId", instance.canonicalId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("moduleResourceInstances", row);
    }
  },
});

export const deleteFromWebhook = internalMutation({
  args: { instance: resourceInstanceValidator },
  handler: async (ctx, { instance }) => {
    const existing = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_canonical_id", (q) => q.eq("canonicalId", instance.canonicalId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

export const cascadeOnModuleDelete = internalMutation({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    const rows = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
