import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import {
  beginMigrationRun,
  finishMigrationRun,
  latestMigrationRun,
  type MigrationBatch,
  type MigrationRunReport,
  migrationBatchValidator,
  migrationRunReport,
  recordMigrationBatch,
} from "../lib/migrationRuns";
import {
  holdsPlaintextTokens,
  platformTokenCipher,
  type SealedPlatformLinkTokens,
  type StoredPlatformLinkTokens,
  sealPlatformLinkTokens,
  storedTokensPatch,
} from "../lib/platformLinkTokens";
import type { TokenCipher } from "../lib/tokenCipher";

/**
 * Seals the tokens of every platform link that still holds them in the clear.
 *
 *   bunx convex run migrations/sealPlatformLinkTokens:default
 *   bunx convex run migrations/sealPlatformLinkTokens:status
 *
 * Reads links a page at a time and converts each on its own: a row that fails
 * is recorded on the run (`migrationRowFailures`) and left as it was, and the
 * rest of the batch carries on. Each conversion is a compare-and-set on the
 * plaintext the action read, so a link relinked or refreshed meanwhile, which
 * is written sealed, is never overwritten. Nothing is deleted or recreated.
 *
 * Idempotent: a link holding no plaintext is skipped, so a second run
 * converts nothing and reports every link as skipped.
 */

const MIGRATION = "sealPlatformLinkTokens";

/** Links read per page. A link is small; the bound keeps one query's read well inside Convex's limits. */
const BATCH_SIZE = 50;

type RowOutcome = "converted" | "changed";

interface LinkPage {
  page: Array<{ _id: Id<"platformLinks"> } & StoredPlatformLinkTokens>;
  continueCursor: string;
  isDone: boolean;
}

export default internalAction({
  args: {},
  handler: async (ctx): Promise<MigrationRunReport> => {
    // Without the key nothing can be sealed; fail before a run is recorded.
    const cipher = await platformTokenCipher();
    const runId: Id<"migrationRuns"> = await ctx.runMutation(internal.migrations.sealPlatformLinkTokens.beginRun, {});

    let cursor: string | null = null;
    for (;;) {
      const page: LinkPage = await ctx.runQuery(internal.migrations.sealPlatformLinkTokens.linkPage, {
        paginationOpts: { numItems: BATCH_SIZE, cursor },
      });

      const batch: MigrationBatch = { scanned: page.page.length, converted: 0, skipped: 0, failures: [] };
      for (const link of page.page) {
        if (!holdsPlaintextTokens(link)) {
          batch.skipped++;
          continue;
        }
        try {
          const outcome: RowOutcome = await ctx.runMutation(internal.migrations.sealPlatformLinkTokens.sealLink, {
            linkId: link._id,
            expectedAccessToken: link.accessToken,
            expectedRefreshToken: link.refreshToken,
            sealed: await sealedFor(cipher, link),
          });
          if (outcome === "converted") {
            batch.converted++;
          } else {
            batch.skipped++;
          }
        } catch (error) {
          batch.failures.push({ documentId: link._id, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      await ctx.runMutation(internal.migrations.sealPlatformLinkTokens.recordBatch, { runId, batch });

      if (page.isDone) {
        break;
      }
      cursor = page.continueCursor;
    }

    return ctx.runMutation(internal.migrations.sealPlatformLinkTokens.finishRun, { runId });
  },
});

/** The sealed pair to store, or undefined when the row already holds one and only its plaintext is left over. */
async function sealedFor(
  cipher: TokenCipher,
  link: StoredPlatformLinkTokens
): Promise<SealedPlatformLinkTokens | undefined> {
  if (link.sealedAccessToken !== undefined && link.sealedRefreshToken !== undefined) {
    return undefined;
  }
  if (link.accessToken === undefined || link.refreshToken === undefined) {
    throw new Error("link holds half a plaintext token pair");
  }
  return sealPlatformLinkTokens(cipher, { accessToken: link.accessToken, refreshToken: link.refreshToken });
}

/** The most recent run, with up to the first hundred rows it failed on. */
export const status = internalQuery({
  args: {},
  handler: (ctx): Promise<MigrationRunReport | null> => latestMigrationRun(ctx, MIGRATION),
});

export const beginRun = internalMutation({
  args: {},
  handler: (ctx): Promise<Id<"migrationRuns">> => beginMigrationRun(ctx, MIGRATION),
});

/** A page of links, each reduced to its id and token fields. Internal: the fields may hold plaintext tokens. */
export const linkPage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }): Promise<LinkPage> => {
    const result = await ctx.db.query("platformLinks").paginate(paginationOpts);
    return {
      page: result.page.map((link) => ({
        _id: link._id,
        accessToken: link.accessToken,
        refreshToken: link.refreshToken,
        sealedAccessToken: link.sealedAccessToken,
        sealedRefreshToken: link.sealedRefreshToken,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Stores the sealed pair and removes the plaintext, if the link still holds
 * exactly the plaintext the action sealed. `changed` when the link is gone or
 * was rewritten meanwhile; every rewrite is sealed, so it needs nothing more.
 */
export const sealLink = internalMutation({
  args: {
    linkId: v.id("platformLinks"),
    expectedAccessToken: v.optional(v.string()),
    expectedRefreshToken: v.optional(v.string()),
    sealed: v.optional(v.object({ sealedAccessToken: v.string(), sealedRefreshToken: v.string() })),
  },
  handler: async (ctx, args): Promise<RowOutcome> => {
    const link = await ctx.db.get(args.linkId);
    if (
      !link ||
      link.accessToken !== args.expectedAccessToken ||
      link.refreshToken !== args.expectedRefreshToken ||
      !holdsPlaintextTokens(link)
    ) {
      return "changed";
    }
    if (args.sealed) {
      await ctx.db.patch(link._id, storedTokensPatch(args.sealed));
      return "converted";
    }
    if (link.sealedAccessToken === undefined || link.sealedRefreshToken === undefined) {
      throw new Error("no sealed pair to keep for a link without one");
    }
    await ctx.db.patch(link._id, { accessToken: undefined, refreshToken: undefined });
    return "converted";
  },
});

export const recordBatch = internalMutation({
  args: { runId: v.id("migrationRuns"), batch: migrationBatchValidator },
  handler: (ctx, { runId, batch }) => recordMigrationBatch(ctx, runId, batch),
});

export const finishRun = internalMutation({
  args: { runId: v.id("migrationRuns") },
  handler: async (ctx, { runId }): Promise<MigrationRunReport> => {
    await finishMigrationRun(ctx, runId);
    const report = await migrationRunReport(ctx, runId);
    if (report === null) {
      throw new Error(`migration run ${runId} vanished while finishing`);
    }
    return report;
  },
});
