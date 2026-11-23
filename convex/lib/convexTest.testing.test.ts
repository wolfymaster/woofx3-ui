import { describe, expect, test } from "bun:test";
import { internal } from "../_generated/api";
import { newBackend, settleBackends } from "./convexTest.testing";

const FAR_FUTURE_MS = 60_000;

describe("settleBackends", () => {
  test("cancels a job a test left pending so it cannot run into the next test", async () => {
    const t = newBackend();
    await t.run(async (ctx) => {
      await ctx.scheduler.runAfter(FAR_FUTURE_MS, internal.engineSync.sweep, {});
    });

    await settleBackends();

    const states = await t.run(async (ctx) => {
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      return jobs.map((job) => job.state.kind);
    });
    expect(states).toEqual(["canceled"]);
  });
});
