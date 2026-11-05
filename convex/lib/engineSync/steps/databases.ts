import { DATABASE_LIMITS } from "@woofx3/api";
import { internal } from "../../../_generated/api";
import { PUBLIC_DATABASE_RECORDS } from "../../../userPageDatabases";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * databasesStep — reconciles the public user page's copy of database rows
 * from the engine's public listing, newest first, for every database with a
 * public column. Self-healing counterpart to the `database.record.changed`
 * webhook: fills rows a missed webhook never brought and drops rows the
 * engine no longer has.
 */
/**
 * Reconciles one database's public rows from the engine's listing, newest
 * first, and returns how many rows the engine listed. Each page is read in
 * its own session: a capnweb batch session is single-use.
 */
export async function reconcileDatabase(
  { ctx, newApi, instanceId }: SyncStepContext,
  databaseId: string
): Promise<number> {
  const startedAt = Date.now();
  const listed: string[] = [];
  for (let offset = 0; offset < PUBLIC_DATABASE_RECORDS; offset += DATABASE_LIMITS.pageSize) {
    const page = await newApi().listPublicDatabaseRecords(databaseId, offset, DATABASE_LIMITS.pageSize);
    await ctx.runMutation(internal.userPageDatabases.reconcilePage, {
      instanceId,
      databaseId,
      records: page.records.map((record) => ({
        recordId: record.id,
        revision: record.revision,
        createdAt: Date.parse(record.createdAt),
        values: record.values,
      })),
    });
    listed.push(...page.records.map((record) => record.id));
    if (page.records.length < DATABASE_LIMITS.pageSize) {
      break;
    }
  }
  await ctx.runMutation(internal.userPageDatabases.finishReconcile, { instanceId, databaseId, listed, startedAt });
  return listed.length;
}

export const databasesStep: SyncStep = {
  name: "databases",
  run: async (context: SyncStepContext) => {
    const databaseIds = await context.ctx.runQuery(internal.userPageDatabases.listPublicDatabaseIds, {
      instanceId: context.instanceId,
    });
    let itemsProcessed = 0;
    for (const databaseId of databaseIds) {
      itemsProcessed += await reconcileDatabase(context, databaseId);
    }
    return { itemsProcessed };
  },
};
