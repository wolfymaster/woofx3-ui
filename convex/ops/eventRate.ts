import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalQuery } from "../_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows read per page; small enough to stay far below a query's read limit. */
const PAGE_SIZE = 2000;

export const webhookEventPage = internalQuery({
  args: { since: v.number(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { since, paginationOpts }) => {
    const result = await ctx.db
      .query("engineEventLog")
      .withIndex("by_received_at", (q) => q.gte("receivedAt", since))
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page
        .filter((row) => row.source === "webhook")
        .map((row) => ({ instanceId: row.instanceId, eventType: row.eventType, receivedAt: row.receivedAt })),
    };
  },
});

/**
 * How many engine events the webhook route received over the last `days`
 * days: per event type, and per instance per UTC day. Measures the real event
 * rate before and after the event queue; run from the CLI with
 * `bunx convex run ops/eventRate:measure '{"days":7}'`.
 */
export const measure = internalAction({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days = 7 }) => {
    const since = Date.now() - days * DAY_MS;
    const byType: Record<string, number> = {};
    const byInstanceDay: Record<string, Record<string, number>> = {};
    let total = 0;
    let cursor: string | null = null;
    for (;;) {
      const result: {
        page: { instanceId: string; eventType: string; receivedAt: number }[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.ops.eventRate.webhookEventPage, {
        since,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      });
      for (const row of result.page) {
        total++;
        byType[row.eventType] = (byType[row.eventType] ?? 0) + 1;
        const day = new Date(row.receivedAt).toISOString().slice(0, 10);
        const perDay = byInstanceDay[row.instanceId] ?? {};
        perDay[day] = (perDay[day] ?? 0) + 1;
        byInstanceDay[row.instanceId] = perDay;
      }
      if (result.isDone) {
        break;
      }
      cursor = result.continueCursor;
    }
    const instanceDays = Object.values(byInstanceDay).reduce((sum, perDay) => sum + Object.keys(perDay).length, 0);
    return {
      days,
      total,
      instances: Object.keys(byInstanceDay).length,
      averagePerActiveInstanceDay: instanceDays === 0 ? 0 : Math.round(total / instanceDays),
      byType,
      byInstanceDay,
    };
  },
});
