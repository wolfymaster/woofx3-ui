import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import { newBackend } from "./lib/convexTest.testing";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";

describe("cleanupOldRuns", () => {
  test("a full batch cleans again until the backlog is gone", async () => {
    const t = newBackend();
    const old = Date.now() - ENGINE_SYNC_CONFIG.runHistoryRetentionMs - 1;
    await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name: "Main",
        url: "https://engine.example",
        hosting: "managed",
        createdAt: 1,
      });
      for (let i = 0; i < ENGINE_SYNC_CONFIG.runHistoryCleanupBatch + 3; i++) {
        await ctx.db.insert("syncRuns", {
          instanceId,
          trigger: "scheduled",
          status: "success",
          startedAt: old,
          steps: [],
        });
      }
    });
    const remaining = () => t.run(async (ctx) => (await ctx.db.query("syncRuns").collect()).length);

    await t.mutation(internal.engineSyncInternal.cleanupOldRuns, {});
    expect(await remaining()).toBe(3);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).toEqual(["engineSyncInternal:cleanupOldRuns"]);

    await t.mutation(internal.engineSyncInternal.cleanupOldRuns, {});
    expect(await remaining()).toBe(0);
  });
});
