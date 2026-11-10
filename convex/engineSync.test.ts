import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { newBackend } from "./lib/convexTest.testing";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";

type Backend = ReturnType<typeof newBackend>;

/** Instances due for a sync whose engines called in just now, so the activity gate passes. */
async function seedDue(
  t: Backend,
  count: number,
  status: Doc<"instanceSync">["status"] = "idle"
): Promise<Id<"instances">[]> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    const ids: Id<"instances">[] = [];
    for (let i = 0; i < count; i++) {
      const instanceId = await ctx.db.insert("instances", {
        accountId,
        name: `Engine ${i}`,
        url: "https://engine.example",
        hosting: "managed",
        createdAt: 1,
        lastEngineActivityAt: Date.now(),
      });
      await ctx.db.insert("instanceSync", {
        instanceId,
        lastSyncedAt: 0,
        nextEligibleAt: i,
        status,
        lastError: "",
        lastDurationMs: 0,
        consecutiveErrorCount: 0,
        syncIntervalMs: ENGINE_SYNC_CONFIG.defaultSyncIntervalMs,
      });
      ids.push(instanceId);
    }
    return ids;
  });
}

async function scheduledNames(t: Backend): Promise<string[]> {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs.map((job) => job.name);
}

describe("sweep", () => {
  test("syncs a running row whose lease has passed", async () => {
    const t = newBackend();
    await seedDue(t, 1, "running");
    const result = await t.mutation(internal.engineSync.sweep, {});
    expect(result.scheduled).toBe(1);
    expect(await scheduledNames(t)).toEqual(["engineSync:runSync"]);
  });

  test("claims each row it schedules, so the next sweep does not schedule it again", async () => {
    const t = newBackend();
    await seedDue(t, 1);
    await t.mutation(internal.engineSync.sweep, {});
    const second = await t.mutation(internal.engineSync.sweep, {});
    expect(second.scheduled).toBe(0);
    expect(await scheduledNames(t)).toEqual(["engineSync:runSync"]);
  });
});

describe("sweep chaining", () => {
  test("a full batch sweeps again at once until the due rows are handled", async () => {
    const t = newBackend();
    await seedDue(t, ENGINE_SYNC_CONFIG.sweepBatchSize + 3);
    const first = await t.mutation(internal.engineSync.sweep, {});
    expect(first.scheduled).toBe(ENGINE_SYNC_CONFIG.sweepBatchSize);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const chained = jobs.filter((job) => job.name === "engineSync:sweep");
    expect(chained.map((job) => job.args)).toEqual([[{ chainedRun: 1 }]]);

    const second = await t.mutation(internal.engineSync.sweep, { chainedRun: 1 });
    expect(second.scheduled).toBe(3);
    expect((await scheduledNames(t)).filter((name) => name === "engineSync:sweep")).toHaveLength(1);
  });

  test("stops chaining at the per-tick cap", async () => {
    const t = newBackend();
    await seedDue(t, ENGINE_SYNC_CONFIG.sweepBatchSize + 1);
    await t.mutation(internal.engineSync.sweep, { chainedRun: ENGINE_SYNC_CONFIG.sweepMaxChainedRuns });
    expect(await scheduledNames(t)).not.toContain("engineSync:sweep");
  });
});

describe("runSync", () => {
  test("an instance without engine credentials is pushed out by its sync interval", async () => {
    const t = newBackend();
    const [instanceId] = await seedDue(t, 1);
    const before = Date.now();
    const result = await t.action(internal.engineSync.runSync, { instanceId, trigger: "scheduled" });
    expect(result).toEqual({ skipped: true, reason: "no-bundle" });
    const row = await t.run((ctx) =>
      ctx.db
        .query("instanceSync")
        .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
        .first()
    );
    expect(row?.nextEligibleAt).toBeGreaterThanOrEqual(
      before + ENGINE_SYNC_CONFIG.defaultSyncIntervalMs - ENGINE_SYNC_CONFIG.jitterMs
    );
  });
});
