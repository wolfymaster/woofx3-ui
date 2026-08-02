import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const resourceInstanceValidator = v.object({
  id: v.string(),
  moduleId: v.string(), // engine UUID — not indexable in Convex, moduleKey is used instead
  moduleName: v.string(),
  kind: v.string(),
  instanceId: v.string(), // manifest-local instance id
  displayName: v.string(),
  canonicalId: v.string(),
  moduleKey: v.string(), // owning module's stable composite key — resolves moduleRepository._id
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

export const listByModule = query({
  args: { instanceId: v.id("instances"), moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    return ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
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
    // Resolve by moduleKey (mirrors reconcileWidgets) — the engine's own moduleId
    // UUID isn't indexable here, and moduleName alone is ambiguous across
    // instances/reinstalls that share a name.
    const moduleRecord = await ctx.db
      .query("moduleRepository")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", instance.moduleKey))
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
