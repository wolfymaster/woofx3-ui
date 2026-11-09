import { describe, expect, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ABANDONED_RUN_ERROR } from "./engineSyncInternal";
import { finishScheduledChain, newBackend } from "./lib/convexTest.testing";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";

type Backend = ReturnType<typeof newBackend>;

async function seedInstance(t: Backend): Promise<{ instanceId: Id<"instances">; userId: Id<"users"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId: userId, createdAt: 1 });
    const instanceId = await ctx.db.insert("instances", {
      accountId,
      name: "Main",
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
    await ctx.db.insert("instanceMembers", { instanceId, userId, role: "owner" });
    await ctx.db.insert("instanceSync", {
      instanceId,
      lastSyncedAt: 0,
      nextEligibleAt: 0,
      status: "idle",
      lastError: "",
      lastDurationMs: 0,
      consecutiveErrorCount: 0,
      syncIntervalMs: ENGINE_SYNC_CONFIG.defaultSyncIntervalMs,
    });
    return { instanceId, userId };
  });
}

async function insertRun(t: Backend, instanceId: Id<"instances">, startedAt: number): Promise<Id<"syncRuns">> {
  return t.run((ctx) =>
    ctx.db.insert("syncRuns", { instanceId, trigger: "scheduled", status: "running", startedAt, steps: [] })
  );
}

async function syncRow(t: Backend, instanceId: Id<"instances">) {
  const row = await t.run((ctx) =>
    ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first()
  );
  if (!row) {
    throw new Error("instanceSync row missing");
  }
  return row;
}

async function seedOldRuns(t: Backend, count: number): Promise<void> {
  const { instanceId } = await seedInstance(t);
  const old = Date.now() - ENGINE_SYNC_CONFIG.runHistoryRetentionMs - 1;
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("syncRuns", {
        instanceId,
        trigger: "scheduled",
        status: "success",
        startedAt: old,
        steps: [],
      });
    }
  });
}

describe("cleanupOldRuns", () => {
  test("a full batch cleans again until the backlog is gone", async () => {
    const t = newBackend();
    await seedOldRuns(t, ENGINE_SYNC_CONFIG.runHistoryCleanupBatch + 3);
    const remaining = () => t.run(async (ctx) => (await ctx.db.query("syncRuns").collect()).length);

    await t.mutation(internal.engineSyncInternal.cleanupOldRuns, {});
    expect(await remaining()).toBe(3);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => [job.name, job.args])).toEqual([["engineSyncInternal:cleanupOldRuns", [{}]]]);

    await t.mutation(internal.engineSyncInternal.cleanupOldRuns, {});
    expect(await remaining()).toBe(0);
  });

  test("a chain of over 100 passes drains the whole backlog", async () => {
    const t = newBackend();
    await seedOldRuns(t, 110);

    await t.mutation(internal.engineSyncInternal.cleanupOldRuns, { batchSize: 1 });
    await finishScheduledChain(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("syncRuns").collect()).length)).toBe(0);
  }, 30_000);
});

describe("startRun", () => {
  test("holds the instance off the sweep for the run's lease", async () => {
    const t = newBackend();
    const { instanceId } = await seedInstance(t);
    const before = Date.now();
    await t.mutation(internal.engineSyncInternal.startRun, { instanceId, trigger: "manual" });
    const row = await syncRow(t, instanceId);
    expect(row.status).toBe("running");
    expect(row.nextEligibleAt).toBeGreaterThanOrEqual(before + ENGINE_SYNC_CONFIG.runLeaseMs);
  });

  test("closes runs past their lease and leaves live ones running", async () => {
    const t = newBackend();
    const { instanceId } = await seedInstance(t);
    const now = Date.now();
    const deadRunId = await insertRun(t, instanceId, now - ENGINE_SYNC_CONFIG.runLeaseMs - 1);
    const liveRunId = await insertRun(t, instanceId, now - 1000);
    await t.mutation(internal.engineSyncInternal.startRun, { instanceId, trigger: "manual" });
    const [dead, live] = await t.run(async (ctx) => [await ctx.db.get(deadRunId), await ctx.db.get(liveRunId)]);
    expect(dead?.status).toBe("error");
    expect(dead?.error).toBe(ABANDONED_RUN_ERROR);
    expect(live?.status).toBe("running");
  });
});

describe("getSyncStateForUser", () => {
  test("a run past its lease is not the run in flight", async () => {
    const t = newBackend();
    const { instanceId, userId } = await seedInstance(t);
    await insertRun(t, instanceId, Date.now() - ENGINE_SYNC_CONFIG.runLeaseMs - 1);
    const state = await t.query(internal.engineSyncInternal.getSyncStateForUser, { instanceId, userId });
    expect(state?.recentRuns).toHaveLength(1);
    expect(state?.currentRun).toBeNull();
  });

  test("a run inside its lease is the run in flight", async () => {
    const t = newBackend();
    const { instanceId, userId } = await seedInstance(t);
    const runId = await insertRun(t, instanceId, Date.now() - 1000);
    const state = await t.query(internal.engineSyncInternal.getSyncStateForUser, { instanceId, userId });
    expect(state?.currentRun?._id).toBe(runId);
  });
});
