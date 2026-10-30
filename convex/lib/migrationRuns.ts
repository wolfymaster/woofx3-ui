import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Run tracking for data migrations in convex/migrations that convert rows
// one at a time: each run records how many rows it saw, converted and left
// alone, and every row it failed on, so an operator can tell a finished
// migration from one that needs another run.

/** Every tracked migration, by the name of its file in convex/migrations. */
export const migrationNameValidator = v.literal("sealPlatformLinkTokens");
export type MigrationName = Infer<typeof migrationNameValidator>;

export interface MigrationBatch {
  scanned: number;
  converted: number;
  skipped: number;
  failures: Array<{ documentId: string; reason: string }>;
}

export const migrationBatchValidator = v.object({
  scanned: v.number(),
  converted: v.number(),
  skipped: v.number(),
  failures: v.array(v.object({ documentId: v.string(), reason: v.string() })),
});

export interface MigrationRunReport {
  runId: Id<"migrationRuns">;
  status: "running" | "completed";
  startedAt: number;
  finishedAt: number | null;
  scanned: number;
  converted: number;
  skipped: number;
  failed: number;
  failures: Array<{ documentId: string; reason: string }>;
}

/** How many failures a report lists; the run's `failed` count is always the full number. */
const REPORTED_FAILURES = 100;

export async function beginMigrationRun(ctx: MutationCtx, migration: MigrationName): Promise<Id<"migrationRuns">> {
  return ctx.db.insert("migrationRuns", {
    migration,
    status: "running",
    startedAt: Date.now(),
    scanned: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
  });
}

export async function recordMigrationBatch(
  ctx: MutationCtx,
  runId: Id<"migrationRuns">,
  batch: MigrationBatch
): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "running") {
    throw new Error(`migration run ${runId} is not running`);
  }
  await ctx.db.patch(runId, {
    scanned: run.scanned + batch.scanned,
    converted: run.converted + batch.converted,
    skipped: run.skipped + batch.skipped,
    failed: run.failed + batch.failures.length,
  });
  for (const failure of batch.failures) {
    await ctx.db.insert("migrationRowFailures", { runId, ...failure });
  }
}

export async function finishMigrationRun(ctx: MutationCtx, runId: Id<"migrationRuns">): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || run.status !== "running") {
    throw new Error(`migration run ${runId} is not running`);
  }
  await ctx.db.patch(runId, { status: "completed", finishedAt: Date.now() });
}

export async function migrationRunReport(
  ctx: QueryCtx,
  runId: Id<"migrationRuns">
): Promise<MigrationRunReport | null> {
  const run = await ctx.db.get(runId);
  if (!run) {
    return null;
  }
  const failures = await ctx.db
    .query("migrationRowFailures")
    .withIndex("by_run", (q) => q.eq("runId", runId))
    .take(REPORTED_FAILURES);
  return {
    runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    scanned: run.scanned,
    converted: run.converted,
    skipped: run.skipped,
    failed: run.failed,
    failures: failures.map(({ documentId, reason }) => ({ documentId, reason })),
  };
}

/** The most recent run of a migration, or null when it has never run. */
export async function latestMigrationRun(ctx: QueryCtx, migration: MigrationName): Promise<MigrationRunReport | null> {
  const run = await ctx.db
    .query("migrationRuns")
    .withIndex("by_migration", (q) => q.eq("migration", migration))
    .order("desc")
    .first();
  return run ? migrationRunReport(ctx, run._id) : null;
}
