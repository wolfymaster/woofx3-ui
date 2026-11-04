import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

/**
 * One-time: schedules engineEventQueue.moveToQueue for every registered
 * instance not yet on the event queue. An engine without the capability is
 * left on the webhook route and moves at a later sync once it upgrades. Safe
 * to run again: a moved instance is skipped.
 *
 *   bunx convex run migrations/moveEnginesToEventQueue:default
 */

const BATCH = 100;

export default internalMutation({
  args: v.object({}),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.migrations.moveEnginesToEventQueue.batch, { cursor: null });
  },
});

export const batch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query("instances").paginate({ numItems: BATCH, cursor });
    for (const instance of result.page) {
      if (instance.clientId && instance.eventsTargetSetAt === undefined) {
        await ctx.scheduler.runAfter(0, internal.engineEventQueue.moveToQueue, { instanceId: instance._id });
      }
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.moveEnginesToEventQueue.batch, {
        cursor: result.continueCursor,
      });
    }
  },
});
