import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { type CuratedSetupPlatform, curatedSetupPlatformError, DEFAULT_SETUP_PLATFORMS } from "./lib/setupPlatforms";

// Curation of the platforms offered at setup. Everything here is internal: the
// list is ours, changed with `bunx convex run`, e.g.
//
//   bunx convex run setupPlatforms:seedDefaults
//   bunx convex run setupPlatforms:upsert '{"marketplaceModuleId":"woofx3_obs","required":false,
//     "defaultSelected":false,"sortOrder":20,"summary":"Switch scenes, show and hide sources"}'
//   bunx convex run setupPlatforms:remove '{"marketplaceModuleId":"woofx3_obs"}'
//
// The setup screen reads it through setupPlatformsActions.listForSetup.

// Bounds the read. The list is a handful of platforms.
const MAX_SETUP_PLATFORMS = 50;

const curatedFields = {
  marketplaceModuleId: v.string(),
  required: v.boolean(),
  defaultSelected: v.boolean(),
  sortOrder: v.number(),
  summary: v.string(),
};

export const listCurated = internalQuery({
  args: {},
  handler: async (ctx): Promise<CuratedSetupPlatform[]> => {
    const rows = await ctx.db.query("setupPlatforms").withIndex("by_sort_order").take(MAX_SETUP_PLATFORMS);
    return rows.map(({ marketplaceModuleId, required, defaultSelected, sortOrder, summary }) => ({
      marketplaceModuleId,
      required,
      defaultSelected,
      sortOrder,
      summary,
    }));
  },
});

export const upsert = internalMutation({
  args: curatedFields,
  handler: async (ctx, entry) => {
    const error = curatedSetupPlatformError(entry);
    if (error) {
      throw new Error(`Invalid setup platform ${entry.marketplaceModuleId}: ${error}`);
    }
    const existing = await ctx.db
      .query("setupPlatforms")
      .withIndex("by_marketplace_module", (q) => q.eq("marketplaceModuleId", entry.marketplaceModuleId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, entry);
      return;
    }
    await ctx.db.insert("setupPlatforms", entry);
  },
});

export const remove = internalMutation({
  args: { marketplaceModuleId: v.string() },
  handler: async (ctx, { marketplaceModuleId }) => {
    const existing = await ctx.db
      .query("setupPlatforms")
      .withIndex("by_marketplace_module", (q) => q.eq("marketplaceModuleId", marketplaceModuleId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Inserts each default platform that has no row yet. Rows that already exist
 * are left as they are, so running it again never undoes a later edit.
 */
export async function seedDefaultSetupPlatforms(ctx: MutationCtx): Promise<string[]> {
  const inserted: string[] = [];
  for (const entry of DEFAULT_SETUP_PLATFORMS) {
    const existing = await ctx.db
      .query("setupPlatforms")
      .withIndex("by_marketplace_module", (q) => q.eq("marketplaceModuleId", entry.marketplaceModuleId))
      .first();
    if (existing) {
      continue;
    }
    await ctx.db.insert("setupPlatforms", { ...entry });
    inserted.push(entry.marketplaceModuleId);
  }
  return inserted;
}

export const seedDefaults = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ inserted: string[] }> => {
    return { inserted: await seedDefaultSetupPlatforms(ctx) };
  },
});
