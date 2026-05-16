import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

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

export const getByCanonicalId = query({
  args: { canonicalId: v.string() },
  handler: async (ctx, { canonicalId }) => {
    return ctx.db
      .query("moduleAssets")
      .withIndex("by_canonical_id", (q) => q.eq("canonicalId", canonicalId))
      .first();
  },
});

export const upsertFromWebhook = internalMutation({
  args: {
    moduleKey: v.string(),
    moduleName: v.string(),
    version: v.string(),
    assets: v.array(assetValidator),
  },
  handler: async (ctx, { moduleKey, moduleName, version, assets }) => {
    const moduleRecord = await ctx.db
      .query("moduleRepository")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", moduleKey))
      .first();

    const moduleId =
      moduleRecord?._id ??
      (
        await ctx.db
          .query("moduleRepository")
          .withIndex("by_name_version", (q) => q.eq("name", moduleName).eq("version", version))
          .first()
      )?._id;

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
        .withIndex("by_canonical_id", (q) => q.eq("canonicalId", asset.canonicalId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, row);
      } else {
        await ctx.db.insert("moduleAssets", row);
      }
    }
  },
});

export const deleteFromWebhook = internalMutation({
  args: { assets: v.array(assetValidator) },
  handler: async (ctx, { assets }) => {
    for (const asset of assets) {
      const existing = await ctx.db
        .query("moduleAssets")
        .withIndex("by_canonical_id", (q) => q.eq("canonicalId", asset.canonicalId))
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
