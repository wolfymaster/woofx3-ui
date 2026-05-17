import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";
import { SYNC_STEPS } from "./lib/engineSync/steps";
import { canAccessAccount } from "./lib/teamAccess";

/**
 * Orchestrator: runs every registered sync step for an instance in order,
 * recording per-step progress and finalizing the run. Each step receives a
 * `newApi` factory rather than a pre-built stub because capnweb's
 * `newHttpBatchRpcSession` is single-use — every engine round-trip (including
 * each page of a paginated read) must open a fresh session.
 */
export const runSync = internalAction({
  args: {
    instanceId: v.id("instances"),
    trigger: v.union(v.literal("scheduled"), v.literal("manual")),
  },
  handler: async (ctx, { instanceId, trigger }) => {
    const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, { instanceId });
    if (!bundle) {
      return { skipped: true, reason: "no-bundle" } as const;
    }

    await ctx.runMutation(internal.engineSyncInternal.ensureInstanceSyncRow, { instanceId });
    const runId: Id<"syncRuns"> = await ctx.runMutation(internal.engineSyncInternal.startRun, {
      instanceId,
      trigger,
    });

    const newApi = (): EngineApi => createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);

    let runErrored = false;
    let runError: string | undefined;

    for (const step of SYNC_STEPS) {
      const stepStart = Date.now();
      await ctx.runMutation(internal.engineSyncInternal.updateRunStep, {
        runId,
        stepName: step.name,
        patch: { status: "running", startedAt: stepStart },
      });
      try {
        const { itemsProcessed } = await step.run({
          ctx,
          newApi,
          instanceId,
          applicationId: bundle.applicationId,
        });
        await ctx.runMutation(internal.engineSyncInternal.updateRunStep, {
          runId,
          stepName: step.name,
          patch: {
            status: "success",
            itemsProcessed,
            completedAt: Date.now(),
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        runErrored = true;
        runError = runError ?? msg;
        await ctx.runMutation(internal.engineSyncInternal.updateRunStep, {
          runId,
          stepName: step.name,
          patch: {
            status: "error",
            error: msg,
            completedAt: Date.now(),
          },
        });
        // best-effort: continue to next step
      }
    }

    await ctx.runMutation(internal.engineSyncInternal.finalizeRun, {
      runId,
      instanceId,
      status: runErrored ? "error" : "success",
      error: runError,
    });

    return { runId, status: runErrored ? "error" : "success" } as const;
  },
});

export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number; deferred: number; seeded: number }> => {
    const now = Date.now();
    const batchSize = ENGINE_SYNC_CONFIG.sweepBatchSize;
    const inactivityCutoff = now - ENGINE_SYNC_CONFIG.inactivityThresholdMs;

    // 1) Seed instanceSync rows for any instances missing one.
    const missing: Array<Id<"instances">> = await ctx.runQuery(
      internal.engineSyncInternal.findInstancesMissingSyncRow,
      {
        limit: batchSize,
      }
    );
    for (const instanceId of missing) {
      await ctx.runMutation(internal.engineSyncInternal.ensureInstanceSyncRow, { instanceId });
    }

    // 2) Pull candidates and partition into schedule vs defer.
    const candidates = await ctx.runQuery(internal.engineSyncInternal.findEligibleCandidates, {
      now,
      limit: batchSize,
    });

    let scheduled = 0;
    let deferred = 0;
    for (const c of candidates) {
      if (c.status === "running") {
        continue;
      }
      if (c.lastActive < inactivityCutoff) {
        await ctx.runMutation(internal.engineSyncInternal.deferIdleInstance, {
          syncRowId: c.syncRowId,
          now,
        });
        deferred++;
        continue;
      }
      await ctx.scheduler.runAfter(0, internal.engineSync.runSync, {
        instanceId: c.instanceId,
        trigger: "scheduled",
      });
      scheduled++;
    }

    return { scheduled, deferred, seeded: missing.length };
  },
});

/**
 * Reactive query the UI subscribes to. Returns the per-instance sync state,
 * the in-flight run (if any), and the last 5 runs. Returns null if the user
 * isn't authenticated or doesn't have access to the instance's account.
 *
 * Implemented with inline `ctx.db` reads because Convex queries cannot call
 * other queries via `ctx.runQuery`.
 */
export const getSyncState = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const inst = await ctx.db.get(instanceId);
    if (!inst) {
      return null;
    }
    const allowed = await canAccessAccount(ctx, inst.accountId, userId);
    if (!allowed) {
      return null;
    }
    const syncState = await ctx.db
      .query("instanceSync")
      .withIndex("by_instance", (q) => q.eq("instanceId", instanceId))
      .first();
    const recentRuns = await ctx.db
      .query("syncRuns")
      .withIndex("by_instance_recent", (q) => q.eq("instanceId", instanceId))
      .order("desc")
      .take(5);
    const currentRun = recentRuns.find((r) => r.status === "running") ?? null;
    return { syncState, currentRun, recentRuns };
  },
});

/**
 * Manual-trigger action. Bypasses the activity gate (the gate only applies to
 * scheduled sweeps). Rejects if a run is already in flight for this instance.
 *
 * The "already running" check is a best-effort read just before scheduling —
 * two simultaneous clicks could race past it and schedule two runs. That's
 * acceptable for v1: `runSync` is idempotent at the lifecycle level.
 */
export const syncNow = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }
    await ctx.runQuery(internal.engineSyncInternal.assertCanSyncInstance, {
      instanceId,
      userId,
    });
    const state = await ctx.runQuery(internal.engineSyncInternal.getSyncStateForUser, {
      instanceId,
      userId,
    });
    if (state?.currentRun) {
      return { scheduled: false as const, reason: "already-running" as const };
    }
    await ctx.runMutation(internal.engineSyncInternal.ensureInstanceSyncRow, { instanceId });
    await ctx.scheduler.runAfter(0, internal.engineSync.runSync, {
      instanceId,
      trigger: "manual",
    });
    return { scheduled: true as const };
  },
});
