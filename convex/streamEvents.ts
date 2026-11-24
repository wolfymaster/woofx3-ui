import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  type PushedStreamFrame,
  readPushedFrame,
  STREAM_EVENT_CORRELATION_KEY,
  STREAM_EVENT_WINDOW,
} from "./lib/streamEvents";
import { isInstanceMember } from "./lib/teamAccess";

/**
 * The newest stream events of an instance, newest first, for its live feed.
 * Empty for a caller who is not a member. A subscriber tells new rows from
 * ones it has seen by `id`.
 */
export const recent = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }): Promise<{ id: string; frame: PushedStreamFrame }[]> => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return [];
    }
    const rows = await ctx.db
      .query("transientEvents")
      .withIndex("by_instance_correlation", (q) =>
        q.eq("instanceId", instanceId).eq("correlationKey", STREAM_EVENT_CORRELATION_KEY)
      )
      .order("desc")
      .take(STREAM_EVENT_WINDOW);
    return rows.flatMap((row) => {
      const frame = readPushedFrame(row.data);
      return frame ? [{ id: row._id, frame }] : [];
    });
  },
});
