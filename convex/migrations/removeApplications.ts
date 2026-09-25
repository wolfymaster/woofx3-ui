import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { TableNames } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";

/**
 * One-time: clear `applicationId` from every table that cached it, then empty
 * the `applications` table. A woofx3 engine is single-tenant, so nothing reads
 * either; they stay in the schema only until this has run on every
 * deployment, after which both come out of `schema.ts`.
 *
 *   bunx convex run migrations/removeApplications:default
 *
 * Works through each table a page at a time and schedules itself for the next
 * page, so no single transaction reads a whole table. Idempotent — a row with
 * no `applicationId` is left alone, and running it again finds nothing to do.
 */

const TABLES_WITH_APPLICATION_ID = [
  "instances",
  "instanceLiveState",
  "chatCommands",
  "chatCommandGroups",
  "workflows",
  "scenes",
  "engineAlerts",
  "workflowRuns",
  "workflowRunSteps",
  "engineEventLog",
] as const satisfies readonly TableNames[];

const PAGE_SIZE = 200;

const tableValidator = v.union(...TABLES_WITH_APPLICATION_ID.map((table) => v.literal(table)));

export default internalMutation({
  args: {
    table: v.optional(tableValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const table = args.table ?? TABLES_WITH_APPLICATION_ID[0];
    const page = await ctx.db.query(table).paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });

    let cleared = 0;
    for (const row of page.page) {
      if (row.applicationId !== undefined) {
        await ctx.db.patch(row._id, { applicationId: undefined });
        cleared++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.removeApplications.default, {
        table,
        cursor: page.continueCursor,
      });
      return { table, cleared, done: false };
    }

    const next = TABLES_WITH_APPLICATION_ID[TABLES_WITH_APPLICATION_ID.indexOf(table) + 1];
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.migrations.removeApplications.default, { table: next });
      return { table, cleared, done: false };
    }

    await ctx.scheduler.runAfter(0, internal.migrations.removeApplications.emptyApplications, {});
    return { table, cleared, done: false };
  },
});

export const emptyApplications = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("applications").take(PAGE_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    if (rows.length === PAGE_SIZE) {
      await ctx.scheduler.runAfter(0, internal.migrations.removeApplications.emptyApplications, {});
    }
    return { deleted: rows.length };
  },
});
