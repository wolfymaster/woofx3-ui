import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

// list: featured marketplace modules for the storefront's featured strip, sorted for display.
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("moduleCatalogFeatured").collect();
    return rows
      .map((row) => ({ moduleKey: row.moduleKey, sortOrder: row.sortOrder }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

// setFeatured: curation-only mutation, run via `bunx convex run moduleFeatured:setFeatured` (no UI yet).
export const setFeatured = internalMutation({
  args: {
    moduleKey: v.string(),
    featured: v.boolean(),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, { moduleKey, featured, sortOrder }) => {
    const existing = await ctx.db
      .query("moduleCatalogFeatured")
      .withIndex("by_module_key", (q) => q.eq("moduleKey", moduleKey))
      .unique();

    if (!featured) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return;
    }

    if (existing) {
      await ctx.db.patch(existing._id, { sortOrder: sortOrder ?? existing.sortOrder });
      return;
    }

    await ctx.db.insert("moduleCatalogFeatured", { moduleKey, sortOrder: sortOrder ?? Date.now() });
  },
});
