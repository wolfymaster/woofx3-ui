import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import { EVENT_LOG_CLEANUP_BATCH } from "./engineEventLog";
import { finishScheduledChain, newBackend } from "./lib/convexTest.testing";

const DAY_MS = 24 * 60 * 60 * 1000;

type Backend = ReturnType<typeof newBackend>;

async function seedOldRows(t: Backend, count: number): Promise<void> {
  const old = Date.now() - 31 * DAY_MS;
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
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("engineEventLog", {
        instanceId,
        eventType: "test",
        payload: "{}",
        source: "webhook",
        receivedAt: old,
      });
    }
  });
}

describe("cleanupOld", () => {
  test("a full batch cleans again until the backlog is gone", async () => {
    const t = newBackend();
    await seedOldRows(t, EVENT_LOG_CLEANUP_BATCH + 3);
    const remaining = () => t.run(async (ctx) => (await ctx.db.query("engineEventLog").collect()).length);

    await t.mutation(internal.engineEventLog.cleanupOld, {});
    expect(await remaining()).toBe(3);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => [job.name, job.args])).toEqual([["engineEventLog:cleanupOld", [{}]]]);

    await t.mutation(internal.engineEventLog.cleanupOld, {});
    expect(await remaining()).toBe(0);
  });

  test("a chain of over 500 passes drains the whole backlog", async () => {
    const t = newBackend();
    await seedOldRows(t, 510);

    await t.mutation(internal.engineEventLog.cleanupOld, { batchSize: 1 });
    await finishScheduledChain(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("engineEventLog").collect()).length)).toBe(0);
  }, 30_000);
});
