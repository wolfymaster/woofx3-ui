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
export const databasesStep: SyncStep = {
  name: "databases",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const databaseIds = await ctx.runQuery(internal.userPageDatabases.listPublicDatabaseIds, { instanceId });
    let itemsProcessed = 0;
    for (const databaseId of databaseIds) {
      const startedAt = Date.now();
      const listed: string[] = [];
      for (let offset = 0; offset < PUBLIC_DATABASE_RECORDS; offset += DATABASE_LIMITS.pageSize) {
        // Each capnweb batch session is single-use, so every page needs its own.
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
        itemsProcessed += page.records.length;
        if (page.records.length < DATABASE_LIMITS.pageSize) {
          break;
        }
      }
      await ctx.runMutation(internal.userPageDatabases.finishReconcile, {
        instanceId,
        databaseId,
        listed,
        startedAt,
      });
    }
    return { itemsProcessed };
  },
};
