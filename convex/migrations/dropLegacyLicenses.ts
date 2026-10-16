import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * One-time: deletes every `licenses` row. Account creation wrote one per
 * account, always free with no features, before plans existed; nothing reads
 * them, and an account without an `accountPlans` row is on the default plan.
 * Safe to run again.
 *
 *   bunx convex run migrations/dropLegacyLicenses:default
 */

const BATCH = 200;

export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.migrations.dropLegacyLicenses.batch, {});
  },
});

export const batch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("licenses").take(BATCH);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === BATCH) {
      await ctx.scheduler.runAfter(0, internal.migrations.dropLegacyLicenses.batch, {});
    }
  },
});
