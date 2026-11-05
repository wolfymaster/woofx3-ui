import { expect, test } from "bun:test";
import { internal } from "../_generated/api";
import { newBackend } from "../lib/convexTest.testing";

test("measure counts webhook events per type and per instance day", async () => {
  const t = newBackend();
  const now = Date.now();
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
    const row = { instanceId, payload: "{}", source: "webhook" as const, receivedAt: now };
    await ctx.db.insert("engineEventLog", { ...row, eventType: "alert.recorded" });
    await ctx.db.insert("engineEventLog", { ...row, eventType: "alert.recorded" });
    await ctx.db.insert("engineEventLog", { ...row, eventType: "workflow.run.recorded" });
    await ctx.db.insert("engineEventLog", { ...row, eventType: "alert.recorded", source: "retrigger" });
    await ctx.db.insert("engineEventLog", { ...row, eventType: "alert.recorded", receivedAt: now - 30 * 86_400_000 });
  });
  const result = await t.action(internal.ops.eventRate.measure, { days: 7 });
  expect(result.total).toBe(3);
  expect(result.instances).toBe(1);
  expect(result.byType).toEqual({ "alert.recorded": 2, "workflow.run.recorded": 1 });
  expect(result.averagePerActiveInstanceDay).toBe(3);
});
