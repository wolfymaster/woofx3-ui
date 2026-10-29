import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-time: deletes the module archives Convex storage held for uploads made
 * before uploads moved to the instance's own storage, and clears the rows'
 * `archiveKey`. The engine keeps its own copy of every installed archive, so
 * nothing reads these. Safe to run again.
 *
 *   bunx convex run migrations/dropModuleArchiveBlobs:default
 */

const BATCH = 100;

export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.migrations.dropModuleArchiveBlobs.batch, { cursor: null });
  },
});

export const batch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("moduleRepository").paginate({ cursor, numItems: BATCH });
    for (const row of page.page) {
      if (row.archiveKey === undefined) {
        continue;
      }
      if (row.archiveKey !== "") {
        // A blob already gone (an uninstall deleted it) is nothing to undo.
        const stored = await ctx.db.system.get(row.archiveKey as Id<"_storage">);
        if (stored !== null) {
          await ctx.storage.delete(row.archiveKey as Id<"_storage">);
        }
      }
      await ctx.db.patch(row._id, { archiveKey: undefined });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.dropModuleArchiveBlobs.batch, {
        cursor: page.continueCursor,
      });
    }
  },
});
