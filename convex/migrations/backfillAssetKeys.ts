import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

/**
 * One-time migration: backfill fileKey and storageProvider on all existing asset
 * records that were created before the storage adapter was introduced.
 *
 * Run with:
 *   npx convex run migrations/backfillAssetKeys
 *
 * For large datasets, pass the returned continueCursor back in:
 *   npx convex run migrations/backfillAssetKeys '{"cursor":"<cursor>"}'
 */
export default internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("assets")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });

    let patched = 0;
    for (const asset of page.page) {
      // Only touch records that have storageId but are missing the new fields
      if (asset.storageId && !asset.fileKey) {
        await ctx.db.patch(asset._id, {
          fileKey: asset.storageId.toString(),
          storageProvider: "convex",
        });
        patched++;
      }
    }

    console.log(
      `Backfill: patched ${patched}/${page.page.length} records. isDone=${page.isDone}`
    );

    return {
      patched,
      isDone: page.isDone,
      continueCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
