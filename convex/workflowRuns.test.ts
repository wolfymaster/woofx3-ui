import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { finishScheduledChain, newBackend } from "./lib/convexTest.testing";
import { WORKFLOW_RUN_CLEANUP_BATCH, WORKFLOW_RUN_RETENTION_MS, WORKFLOW_RUN_STEP_CLEANUP_BATCH } from "./workflowRuns";

type Backend = ReturnType<typeof newBackend>;

afterEach(() => {
  setSystemTime();
});

async function seedInstance(t: Backend, name = "Main"): Promise<Id<"instances">> {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { name: "Owner" });
    const accountId = await ctx.db.insert("accounts", { name: "Acct", ownerId, createdAt: 1 });
    return ctx.db.insert("instances", {
      accountId,
      name,
      url: "https://engine.example",
      hosting: "managed",
      createdAt: 1,
    });
  });
}

/** A run and one step of it, both stored now (by the test clock). */
async function seedRun(t: Backend, instanceId: Id<"instances">, engineRunId: string): Promise<void> {
  await t.run(async (ctx) => {
    const stamp = "2026-11-01T00:00:00Z";
    await ctx.db.insert("workflowRuns", {
      instanceId,
      engineRunId,
      workflowId: "wf",
      status: "completed",
      engineCreatedAt: stamp,
      engineUpdatedAt: stamp,
      createdAt: Date.now(),
    });
    await ctx.db.insert("workflowRunSteps", {
      instanceId,
      engineStepId: `${engineRunId}-step`,
      runId: engineRunId,
      taskId: "task",
      status: "completed",
      attempt: 1,
      stepIndex: 0,
      engineCreatedAt: stamp,
      engineUpdatedAt: stamp,
      createdAt: Date.now(),
    });
  });
}

async function counts(t: Backend): Promise<{ runs: number; steps: number }> {
  return t.run(async (ctx) => ({
    runs: (await ctx.db.query("workflowRuns").collect()).length,
    steps: (await ctx.db.query("workflowRunSteps").collect()).length,
  }));
}

async function scheduledNames(t: Backend): Promise<string[]> {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs.map((job) => job.name);
}

describe("cleanupOld", () => {
  test("deletes runs past retention with their steps and keeps recent ones", async () => {
    const t = newBackend();
    // convex-test never hands out a creation time earlier than one it already gave, so the past is seeded first.
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    await seedRun(t, instanceId, "old");
    setSystemTime();
    await seedRun(t, instanceId, "new");

    await t.mutation(internal.workflowRuns.cleanupOld, {});
    const left = await t.run(async (ctx) => ({
      runs: (await ctx.db.query("workflowRuns").collect()).map((run) => run.engineRunId),
      steps: (await ctx.db.query("workflowRunSteps").collect()).map((step) => step.runId),
    }));
    expect(left).toEqual({ runs: ["new"], steps: ["new"] });
  });

  test("a full batch cleans again until the backlog is gone", async () => {
    const t = newBackend();
    // convex-test never hands out a creation time earlier than one it already gave, so the past is seeded first.
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < WORKFLOW_RUN_CLEANUP_BATCH + 2; i++) {
      await seedRun(t, instanceId, `run-${i}`);
    }
    setSystemTime();

    await t.mutation(internal.workflowRuns.cleanupOld, {});
    expect(await counts(t)).toEqual({ runs: 2, steps: 2 });
    expect(await scheduledNames(t)).toEqual(["workflowRuns:cleanupOld"]);
    await t.mutation(internal.workflowRuns.cleanupOld, {});
    expect(await counts(t)).toEqual({ runs: 0, steps: 0 });
  });

  test("a chain of over 500 passes drains the whole backlog", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < 510; i++) {
      await seedRun(t, instanceId, `run-${i}`);
    }
    setSystemTime();

    await t.mutation(internal.workflowRuns.cleanupOld, { batchSize: 1 });
    await finishScheduledChain(t);
    expect(await counts(t)).toEqual({ runs: 0, steps: 0 });
  }, 30_000);
});

/** A step whose run was never recorded, stored now (by the test clock). */
async function seedOrphanStep(t: Backend, instanceId: Id<"instances">, engineRunId: string): Promise<void> {
  await t.run(async (ctx) => {
    const stamp = "2026-11-01T00:00:00Z";
    await ctx.db.insert("workflowRunSteps", {
      instanceId,
      engineStepId: `${engineRunId}-step`,
      runId: engineRunId,
      taskId: "task",
      status: "completed",
      attempt: 1,
      stepIndex: 0,
      engineCreatedAt: stamp,
      engineUpdatedAt: stamp,
      createdAt: Date.now(),
    });
  });
}

type OrphanStepPass = { next?: { cursor: string; cutoff: number }; batchSize?: number };

/** The arguments of every scheduled orphan-step pass, in scheduling order. */
async function scheduledOrphanStepPasses(t: Backend): Promise<OrphanStepPass[]> {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs
    .filter((job) => job.name === "workflowRuns:cleanupOrphanSteps")
    .map((job) => job.args[0] as OrphanStepPass);
}

describe("cleanupOrphanSteps", () => {
  test("deletes old steps whose run never arrived and keeps the rest", async () => {
    const t = newBackend();
    // convex-test never hands out a creation time earlier than one it already gave, so the past is seeded first.
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    await seedOrphanStep(t, instanceId, "old-orphan");
    await seedOrphanStep(t, instanceId, "late-run");
    setSystemTime();
    await seedRun(t, instanceId, "late-run");
    await seedOrphanStep(t, instanceId, "new-orphan");

    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, {});
    const steps = await t.run(async (ctx) => (await ctx.db.query("workflowRunSteps").collect()).map((s) => s.runId));
    expect(steps.sort()).toEqual(["late-run", "late-run", "new-orphan"]);
  });

  test("a step whose run belongs to another instance is an orphan", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const mine = await seedInstance(t, "Mine");
    const other = await seedInstance(t, "Other");
    await seedOrphanStep(t, mine, "shared-id");
    setSystemTime();
    await seedRun(t, other, "shared-id");

    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, {});
    const steps = await t.run(async (ctx) =>
      (await ctx.db.query("workflowRunSteps").collect()).map((s) => s.instanceId)
    );
    expect(steps).toEqual([other]);
  });

  test("continues past a full page, even when the page held no orphans", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < WORKFLOW_RUN_STEP_CLEANUP_BATCH; i++) {
      await seedOrphanStep(t, instanceId, "late-run");
    }
    await seedOrphanStep(t, instanceId, "orphan");
    setSystemTime();
    await seedRun(t, instanceId, "late-run");

    expect(await t.mutation(internal.workflowRuns.cleanupOrphanSteps, {})).toBe(0);
    const [job] = await scheduledOrphanStepPasses(t);
    expect(await t.mutation(internal.workflowRuns.cleanupOrphanSteps, job)).toBe(1);
  });

  test("chained passes keep the first pass's cutoff, which their cursor depends on", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < 2 * WORKFLOW_RUN_STEP_CLEANUP_BATCH + 1; i++) {
      await seedOrphanStep(t, instanceId, "late-run");
    }
    setSystemTime();
    await seedRun(t, instanceId, "late-run");

    const firstPassAt = Date.now();
    setSystemTime(new Date(firstPassAt));
    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, {});
    const [second] = await scheduledOrphanStepPasses(t);
    expect(second.next?.cutoff).toBe(firstPassAt - WORKFLOW_RUN_RETENTION_MS);

    setSystemTime(new Date(firstPassAt + 60_000));
    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, second);
    const passes = await scheduledOrphanStepPasses(t);
    expect(passes.map((pass) => pass.next?.cutoff)).toEqual([second.next?.cutoff, second.next?.cutoff]);
  });

  test("reaches an orphan behind over 500 pages of steps whose run exists", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < 510; i++) {
      await seedOrphanStep(t, instanceId, "late-run");
    }
    await seedOrphanStep(t, instanceId, "orphan");
    setSystemTime();
    await seedRun(t, instanceId, "late-run");

    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, { batchSize: 1 });
    await finishScheduledChain(t);
    const steps = await t.run(async (ctx) => (await ctx.db.query("workflowRunSteps").collect()).map((s) => s.runId));
    expect(steps).toHaveLength(511);
    expect(steps).not.toContain("orphan");
  }, 30_000);

  test("a chain of over 500 passes reads the whole index", async () => {
    const t = newBackend();
    setSystemTime(new Date(Date.now() - WORKFLOW_RUN_RETENTION_MS - 60_000));
    const instanceId = await seedInstance(t);
    for (let i = 0; i < 510; i++) {
      await seedOrphanStep(t, instanceId, `orphan-${i}`);
    }
    setSystemTime();

    await t.mutation(internal.workflowRuns.cleanupOrphanSteps, { batchSize: 1 });
    await finishScheduledChain(t);
    expect(await counts(t)).toEqual({ runs: 0, steps: 0 });
  }, 30_000);
});

describe("deleteInstanceData", () => {
  test("deletes the instance's runs and steps and leaves another instance's same-id run", async () => {
    const t = newBackend();
    const doomed = await seedInstance(t, "Doomed");
    const other = await seedInstance(t, "Other");
    await seedRun(t, doomed, "shared-id");
    await seedRun(t, other, "shared-id");

    await t.mutation(internal.instances.deleteInstanceData, { instanceId: doomed });
    expect(await scheduledNames(t)).toContain("workflowRuns:deleteForInstance");
    await t.mutation(internal.workflowRuns.deleteForInstance, { instanceId: doomed });

    const left = await t.run(async (ctx) => ({
      runs: (await ctx.db.query("workflowRuns").collect()).map((run) => run.instanceId),
      steps: (await ctx.db.query("workflowRunSteps").collect()).map((step) => step.instanceId),
    }));
    expect(left).toEqual({ runs: [other], steps: [other] });
  });
});
