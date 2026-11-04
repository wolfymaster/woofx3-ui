import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * One-time: clears the engine version and capability ids every instance
 * recorded for operators. Nothing reads them, and the schema drops the
 * fields once this has run. Safe to run again.
 *
 *   bunx convex run migrations/dropEngineReports:default
 */

const BATCH = 200;

export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.migrations.dropEngineReports.batch, {
      paginationOpts: { numItems: BATCH, cursor: null },
    });
  },
});

export const batch = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const page = await ctx.db.query("instances").paginate(paginationOpts);
    for (const instance of page.page) {
      if (
        instance.engineVersion !== undefined ||
        instance.engineCapabilityIds !== undefined ||
        instance.engineCapabilitiesSeenAt !== undefined ||
        instance.engineSeenAt !== undefined
      ) {
        await ctx.db.patch(instance._id, {
          engineVersion: undefined,
          engineCapabilityIds: undefined,
          engineCapabilitiesSeenAt: undefined,
          engineSeenAt: undefined,
        });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.dropEngineReports.batch, {
        paginationOpts: { numItems: BATCH, cursor: page.continueCursor },
      });
    }
  },
});
