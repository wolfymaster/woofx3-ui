import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

/**
 * Resolve owning moduleRepository row for a resource-instance snapshot.
 * Prefer exact moduleKey; fall back to marketplace-id prefix or name within
 * the Convex instance so webhook/sync rows are not silently dropped when the
 * engine's stored moduleKey drifted from Convex.
 */
async function resolveOwningModule(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  moduleKey: string,
  moduleName: string
): Promise<Doc<"moduleRepository"> | null> {
  if (moduleKey) {
    const byKey = await ctx.db
      .query("moduleRepository")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", moduleKey))
      .first();
    if (byKey) {
      return byKey;
    }
  }

  const forInstance = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
    .collect();

  if (moduleKey) {
    const prefix = moduleKey.split(":")[0];
    if (prefix) {
      const byPrefix = forInstance.find((m) => m.moduleKey?.startsWith(`${prefix}:`));
      if (byPrefix) {
        return byPrefix;
      }
    }
  }

  if (moduleName) {
    const byName = forInstance.find((m) => m.name === moduleName);
    if (byName) {
      return byName;
    }
  }

  return null;
}

async function upsertRow(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  moduleRecordId: Id<"moduleRepository">,
  instance: {
    id: string;
    instanceId: string;
    moduleName: string;
    kind: string;
    displayName: string;
    canonicalId: string;
  }
) {
  const row = {
    instanceId,
    moduleId: moduleRecordId,
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
}

export const upsertFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    instance: resourceInstanceValidator,
  },
  handler: async (ctx, { instanceId, instance }) => {
    const moduleRecord = await resolveOwningModule(ctx, instanceId, instance.moduleKey, instance.moduleName);
    if (!moduleRecord) {
      return;
    }
    await upsertRow(ctx, instanceId, moduleRecord._id, instance);
  },
});

/**
 * Upsert engine-listed instances for a known moduleRepository row, then prune
 * stale rows for that module. Used by the RESOURCES tab so engine Postgres
 * rows appear even when create webhooks never reached Convex.
 */
export const reconcileForModule = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleId: v.id("moduleRepository"),
    instances: v.array(resourceInstanceValidator),
  },
  handler: async (ctx, { instanceId, moduleId, instances }) => {
    const moduleRecord = await ctx.db.get(moduleId);
    if (!moduleRecord || moduleRecord.instanceId !== instanceId) {
      return { itemsProcessed: 0 };
    }

    const seen = new Set<string>();
    for (const instance of instances) {
      seen.add(instance.canonicalId);
      await upsertRow(ctx, instanceId, moduleId, instance);
    }

    const liveRows = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
    for (const row of liveRows) {
      if (!seen.has(row.canonicalId)) {
        await ctx.db.delete(row._id);
      }
    }

    return { itemsProcessed: instances.length };
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
