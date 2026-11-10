import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";

type Backend = ReturnType<typeof newBackend>;

/** An instance with no engine credentials yet, recorded as live. */
async function seedLiveUnregistered(t: Backend): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceLiveState", {
      instanceId,
      isLive: true,
      startedAt: "2026-11-07T10:00:00Z",
      streamTitle: "Live",
      lastUpdateSource: "webhook",
      lastUpdatedAt: 1,
    });
    return instanceId;
  });
}

async function liveRows(t: Backend) {
  return t.run((ctx) => ctx.db.query("instanceLiveState").collect());
}

describe("syncInstanceLiveState", () => {
  test("an instance without engine credentials is recorded as not live, so the sweep stops polling it", async () => {
    const t = newBackend();
    await seedLiveUnregistered(t);
    const [row] = await liveRows(t);
    expect(await t.action(internal.streamStatus.syncInstanceLiveState, { instanceId: row.instanceId })).toBe(false);
    const [after] = await liveRows(t);
    expect(after.isLive).toBe(false);
    expect(after.streamTitle).toBeUndefined();

    await t.mutation(internal.streamStatus.sweepLiveState, {});
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toEqual([]);
  });

  test("a row whose instance is gone is deleted", async () => {
    const t = newBackend();
    const instanceId = await seedLiveUnregistered(t);
    await t.run((ctx) => ctx.db.delete(instanceId));
    await t.action(internal.streamStatus.syncInstanceLiveState, { instanceId });
    expect(await liveRows(t)).toEqual([]);
  });
});

describe("deleteInstanceData", () => {
  test("deletes the instance's live state", async () => {
    const t = newBackend();
    const instanceId = await seedLiveUnregistered(t);
    await t.mutation(internal.instances.deleteInstanceData, { instanceId });
    expect(await liveRows(t)).toEqual([]);
  });
});
