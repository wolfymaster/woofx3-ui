import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import { EVENT_LOG_CLEANUP_BATCH } from "./engineEventLog";
import { newBackend } from "./lib/convexTest.testing";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("cleanupOld", () => {
  test("a full batch cleans again until the backlog is gone", async () => {
    const t = newBackend();
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
      for (let i = 0; i < EVENT_LOG_CLEANUP_BATCH + 3; i++) {
        await ctx.db.insert("engineEventLog", {
          instanceId,
          eventType: "test",
          payload: "{}",
          source: "webhook",
          receivedAt: old,
        });
      }
    });
    const remaining = () => t.run(async (ctx) => (await ctx.db.query("engineEventLog").collect()).length);

    await t.mutation(internal.engineEventLog.cleanupOld, {});
    expect(await remaining()).toBe(3);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).toEqual(["engineEventLog:cleanupOld"]);

    await t.mutation(internal.engineEventLog.cleanupOld, {});
    expect(await remaining()).toBe(0);
  });
});
