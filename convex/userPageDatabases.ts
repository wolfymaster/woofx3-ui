import { parseDatabaseColumns } from "@shared/databases/columns";
import { DATABASE_KIND } from "@shared/resource-kinds";
import type { DatabaseValue } from "@woofx3/api";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { insertEvent } from "./transientEvents";

/**
 * The public user page's copy of database rows: only columns public at the
 * time, newest `PUBLIC_DATABASE_RECORDS` per database. Writes come from the
 * `database.record.changed` webhook and the engineSync reconcile, each newer
 * revision replacing an older one, so redelivered and reordered webhooks
 * converge.
 */

/** Rows kept per database; older ones are trimmed. */
export const PUBLIC_DATABASE_RECORDS = 1000;
/** Rows stripped or deleted per scheduled cleanup run. */
const CLEANUP_BATCH = 200;
/** Database instances read per engineSync pass; an instance holds far fewer. */
const DATABASES_PER_INSTANCE_READ = 500;
/** How long the change transient lives; a dashboard only needs to see it once. */
const CHANGE_TRANSIENT_TTL_MS = 30_000;

/** The correlation key of a database's change transient. Must match client/src/engine/convex/databases.ts. */
export function databaseChangeKey(databaseId: string): string {
  return `database:${databaseId}`;
}

const cellValue = v.union(v.string(), v.number(), v.boolean());

export const recordChangeValidator = v.object({
  databaseId: v.string(),
  recordId: v.string(),
  op: v.union(v.literal("created"), v.literal("updated"), v.literal("deleted")),
  revision: v.number(),
  createdAt: v.string(),
  publicValues: v.union(v.record(v.string(), cellValue), v.null()),
});

type Cells = Doc<"userPageDatabaseRecords">["values"];

/** The ids of the columns a database instance marks public now; empty for an unknown database. */
export async function currentPublicColumns(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  databaseId: string
): Promise<Set<string>> {
  const instance = await ctx.db
    .query("moduleResourceInstances")
    .withIndex("by_instance_canonical", (q) => q.eq("instanceId", instanceId).eq("canonicalId", databaseId))
    .first();
  if (!instance || `${instance.moduleName}:${instance.kind}` !== DATABASE_KIND) {
    return new Set();
  }
  const settings =
    instance.settings && typeof instance.settings === "object" ? (instance.settings as Record<string, unknown>) : {};
  return new Set(
    parseDatabaseColumns(settings)
      .filter((column) => column.public)
      .map((column) => column.id)
  );
}

/** The cells of `values` in a public column, in a stable order. */
export function publicCells(values: Record<string, DatabaseValue>, publicColumns: ReadonlySet<string>): Cells {
  return Object.keys(values)
    .filter((columnId) => publicColumns.has(columnId))
    .sort()
    .map((columnId) => ({ columnId, value: values[columnId] }));
}

async function recordRow(ctx: MutationCtx, instanceId: Id<"instances">, databaseId: string, recordId: string) {
  return ctx.db
    .query("userPageDatabaseRecords")
    .withIndex("by_instance_database_record", (q) =>
      q.eq("instanceId", instanceId).eq("databaseId", databaseId).eq("recordId", recordId)
    )
    .unique();
}

/**
 * Writes one row's public cells unless what is stored is as new or newer. A
 * database with no public column keeps nothing.
 */
async function upsertIfNewer(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  row: { databaseId: string; recordId: string; revision: number; createdAt: number; values: Cells },
  hasPublicColumn: boolean
): Promise<void> {
  const existing = await recordRow(ctx, instanceId, row.databaseId, row.recordId);
  if (existing && existing.revision >= row.revision) {
    return;
  }
  if (!hasPublicColumn) {
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return;
  }
  const doc = { instanceId, ...row, updatedAt: Date.now() };
  if (existing) {
    await ctx.db.patch(existing._id, doc);
  } else {
    await ctx.db.insert("userPageDatabaseRecords", doc);
  }
}

/** Deletes a database's rows beyond the newest PUBLIC_DATABASE_RECORDS. */
async function trim(ctx: MutationCtx, instanceId: Id<"instances">, databaseId: string): Promise<void> {
  const newest = await ctx.db
    .query("userPageDatabaseRecords")
    .withIndex("by_instance_database_created", (q) => q.eq("instanceId", instanceId).eq("databaseId", databaseId))
    .order("desc")
    .take(PUBLIC_DATABASE_RECORDS + CLEANUP_BATCH);
  for (const row of newest.slice(PUBLIC_DATABASE_RECORDS)) {
    await ctx.db.delete(row._id);
  }
}

/**
 * The `database.record.changed` webhook: the projection's write and the
 * dashboard's change transient, in one mutation.
 */
export const applyRecordChange = internalMutation({
  args: { instanceId: v.id("instances"), change: recordChangeValidator },
  handler: async (ctx, { instanceId, change }) => {
    if (change.op === "deleted") {
      const existing = await recordRow(ctx, instanceId, change.databaseId, change.recordId);
      if (existing && existing.revision < change.revision) {
        await ctx.db.delete(existing._id);
      }
    } else {
      const publicColumns = await currentPublicColumns(ctx, instanceId, change.databaseId);
      await upsertIfNewer(
        ctx,
        instanceId,
        {
          databaseId: change.databaseId,
          recordId: change.recordId,
          revision: change.revision,
          createdAt: Date.parse(change.createdAt),
          values: publicCells(change.publicValues ?? {}, publicColumns),
        },
        publicColumns.size > 0
      );
      await trim(ctx, instanceId, change.databaseId);
    }
    await insertEvent(ctx, {
      instanceId,
      correlationKey: databaseChangeKey(change.databaseId),
      type: "database.record.changed",
      status: "success",
      data: { recordId: change.recordId, op: change.op, revision: change.revision },
      ttlMs: CHANGE_TRANSIENT_TTL_MS,
    });
  },
});

const reconciledRecord = v.object({
  recordId: v.string(),
  revision: v.number(),
  createdAt: v.number(),
  values: v.record(v.string(), cellValue),
});

/**
 * One page of the engine's public listing of a database, newest first, from
 * the engineSync `databases` step. Rows the engine no longer lists are
 * removed by `finishReconcile` once every page is in.
 */
export const reconcilePage = internalMutation({
  args: { instanceId: v.id("instances"), databaseId: v.string(), records: v.array(reconciledRecord) },
  handler: async (ctx, { instanceId, databaseId, records }) => {
    const publicColumns = await currentPublicColumns(ctx, instanceId, databaseId);
    for (const record of records) {
      await upsertIfNewer(
        ctx,
        instanceId,
        {
          databaseId,
          recordId: record.recordId,
          revision: record.revision,
          createdAt: record.createdAt,
          values: publicCells(record.values, publicColumns),
        },
        publicColumns.size > 0
      );
    }
    return { itemsProcessed: records.length };
  },
});

/**
 * Drops the rows of a database the engine did not list, once the reconcile
 * has read its newest rows. `listed` holds every row id it read.
 */
export const finishReconcile = internalMutation({
  args: { instanceId: v.id("instances"), databaseId: v.string(), listed: v.array(v.string()) },
  handler: async (ctx, { instanceId, databaseId, listed }) => {
    const keep = new Set(listed);
    const rows = await ctx.db
      .query("userPageDatabaseRecords")
      .withIndex("by_instance_database_created", (q) => q.eq("instanceId", instanceId).eq("databaseId", databaseId))
      .take(PUBLIC_DATABASE_RECORDS + CLEANUP_BATCH);
    for (const row of rows) {
      if (!keep.has(row.recordId)) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

/**
 * Makes a database's stored rows match its current public columns: strips a
 * column no longer public, and deletes every row of a database that has none
 * or no longer exists. Runs in batches, scheduling itself for the next one,
 * so a large database is cleaned without one oversized mutation.
 */
export const cleanupDatabase = internalMutation({
  args: {
    instanceId: v.id("instances"),
    databaseId: v.string(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { instanceId, databaseId, cursor }) => {
    const publicColumns = await currentPublicColumns(ctx, instanceId, databaseId);
    const page = await ctx.db
      .query("userPageDatabaseRecords")
      .withIndex("by_instance_database_created", (q) => q.eq("instanceId", instanceId).eq("databaseId", databaseId))
      .paginate({ cursor, numItems: CLEANUP_BATCH });
    for (const row of page.page) {
      if (publicColumns.size === 0) {
        await ctx.db.delete(row._id);
        continue;
      }
      const kept = row.values.filter((cell) => publicColumns.has(cell.columnId));
      if (kept.length !== row.values.length) {
        await ctx.db.patch(row._id, { values: kept, updatedAt: Date.now() });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.userPageDatabases.cleanupDatabase, {
        instanceId,
        databaseId,
        cursor: page.continueCursor,
      });
    }
  },
});

/** Schedules `cleanupDatabase` for a database instance that changed or went away. */
export async function scheduleDatabaseCleanup(
  ctx: MutationCtx,
  instanceId: Id<"instances">,
  databaseId: string
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.userPageDatabases.cleanupDatabase, { instanceId, databaseId, cursor: null });
}

/** The databases of an instance with a public column, which the engineSync step reconciles. */
export const listPublicDatabaseIds = internalQuery({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const [moduleName, kind] = DATABASE_KIND.split(":");
    const rows = await ctx.db
      .query("moduleResourceInstances")
      .withIndex("by_instance_kind", (q) => q.eq("instanceId", instanceId).eq("kind", kind))
      .take(DATABASES_PER_INSTANCE_READ);
    return rows
      .filter((row) => row.moduleName === moduleName)
      .filter((row) => {
        const settings =
          row.settings && typeof row.settings === "object" ? (row.settings as Record<string, unknown>) : {};
        return parseDatabaseColumns(settings).some((column) => column.public);
      })
      .map((row) => row.canonicalId);
  },
});
