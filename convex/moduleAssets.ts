import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";

const assetValidator = v.object({
  id: v.string(),
  canonicalId: v.string(),
  projectionKey: v.string(),
  manifestId: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  repositoryKey: v.string(),
  manifestPath: v.string(),
  kind: v.optional(v.string()),
  contentType: v.optional(v.string()),
  createdByType: v.string(),
  createdByRef: v.string(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("moduleAssets").collect();
  },
});

export const listByModule = query({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    return ctx.db
      .query("moduleAssets")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
  },
});

/**
 * The instance's own row for the module these assets belong to. Assets are
 * identified by `moduleId` + `canonicalId`: `canonicalId` alone is shared by
 * every tenant that installed the module, and this table has no instanceId of
 * its own — the module row is what carries the tenant.
 */
async function resolveModuleId(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  moduleKey: string,
  moduleName: string,
  version: string
): Promise<Id<"moduleRepository"> | undefined> {
  const byKey = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance_module_key", (q) => q.eq("instanceId", instanceId).eq("moduleKey", moduleKey))
    .first();
  if (byKey) {
    return byKey._id;
  }
  const byNameVersion = await ctx.db
    .query("moduleRepository")
    .withIndex("by_instance_name_version", (q) =>
      q.eq("instanceId", instanceId).eq("name", moduleName).eq("version", version)
    )
    .first();
  return byNameVersion?._id;
}

export const upsertFromWebhook = internalMutation({
  args: {
    // The delivering instance, from the webhook's Bearer token. Required to
    // resolve the owning module: moduleKey and name+version are both shared
    // between tenants that installed the same module.
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    moduleName: v.string(),
    version: v.string(),
    assets: v.array(assetValidator),
  },
  handler: async (ctx, { instanceId, moduleKey, moduleName, version, assets }) => {
    const moduleId = await resolveModuleId(ctx, instanceId, moduleKey, moduleName, version);
    if (!moduleId) {
      return;
    }

    for (const asset of assets) {
      const row = {
        moduleId,
        engineAssetId: asset.id,
        canonicalId: asset.canonicalId,
        projectionKey: asset.projectionKey,
        manifestId: asset.manifestId,
        name: asset.name,
        description: asset.description,
        repositoryKey: asset.repositoryKey,
        manifestPath: asset.manifestPath,
        kind: asset.kind,
        contentType: asset.contentType,
        createdByType: asset.createdByType,
        createdByRef: asset.createdByRef,
      };

      const existing = await ctx.db
        .query("moduleAssets")
        .withIndex("by_module_canonical", (q) => q.eq("moduleId", moduleId).eq("canonicalId", asset.canonicalId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("moduleAssets", row);
      }
    }
  },
});

/**
 * Deregistration carries the same module identity as the registration that
 * created the rows, so resolve the instance's module first and delete within
 * it. If the module row is already gone — the engine fires this during a module
 * delete, and `module.deleted` may land first — there is nothing left to do:
 * `cascadeOnModuleDelete` removes every asset row for that module.
 */
export const deleteFromWebhook = internalMutation({
  args: {
    instanceId: v.id("instances"),
    moduleKey: v.string(),
    moduleName: v.string(),
    version: v.string(),
    assets: v.array(assetValidator),
  },
  handler: async (ctx, { instanceId, moduleKey, moduleName, version, assets }) => {
    const moduleId = await resolveModuleId(ctx, instanceId, moduleKey, moduleName, version);
    if (!moduleId) {
      return;
    }

    for (const asset of assets) {
      const existing = await ctx.db
        .query("moduleAssets")
        .withIndex("by_module_canonical", (q) => q.eq("moduleId", moduleId).eq("canonicalId", asset.canonicalId))
        .first();
      if (existing) {
        await ctx.db.delete(existing._id);
      }
    }
  },
});

export const cascadeOnModuleDelete = internalMutation({
  args: { moduleId: v.id("moduleRepository") },
  handler: async (ctx, { moduleId }) => {
    const rows = await ctx.db
      .query("moduleAssets")
      .withIndex("by_module", (q) => q.eq("moduleId", moduleId))
      .collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
