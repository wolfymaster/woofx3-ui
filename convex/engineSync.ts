import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, query } from "./_generated/server";
import { createEngineRpcSession, type EngineApi } from "./lib/engineInstanceUrl";
import { isEngineActive } from "./lib/engineSync/activity";
import { ENGINE_SYNC_CONFIG } from "./lib/engineSync/config";
import { SYNC_STEPS } from "./lib/engineSync/steps";
import { reconcileDatabase } from "./lib/engineSync/steps/databases";
import { readSyncState } from "./lib/engineSync/syncRow";
import { syncTriggerValidator } from "./lib/engineSync/trigger";
import { requireInstanceRoleInAction } from "./lib/instanceAccess";
import { isInstanceMember } from "./lib/teamAccess";

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
    trigger: syncTriggerValidator,
  },
  handler: async (ctx, { instanceId, trigger }) => {
    const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, { instanceId });
    if (!bundle) {
      await ctx.runMutation(internal.engineSyncInternal.deferUnsyncable, { instanceId });
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

/**
 * Reconciles one database's public rows outside a full sync, for a database
 * that just gained a public column: rows already written carry no value for
 * it until the engine's listing is read again.
 */
export const reconcileDatabaseNow = internalAction({
  args: { instanceId: v.id("instances"), databaseId: v.string() },
  handler: async (ctx, { instanceId, databaseId }) => {
    const bundle = await ctx.runQuery(internal.engineSyncInternal.getInstanceBundle, { instanceId });
    if (!bundle) {
      return { skipped: true, reason: "no-bundle" } as const;
    }
    const newApi = (): EngineApi => createEngineRpcSession<EngineApi>(bundle.url, bundle.clientId, bundle.clientSecret);
    const listed = await reconcileDatabase({ ctx, newApi, instanceId }, databaseId);
    return { skipped: false, listed } as const;
  },
});

/**
 * Cron entry point. Each pass reads at most `sweepBatchSize` rows whose
 * nextEligibleAt has passed, so an idle fleet costs a single empty index read
 * however many instances exist. A full batch schedules the next pass at once,
 * up to `sweepMaxChainedRuns` passes per tick, so a large fleet is not capped
 * at one batch per tick. Instances get their row at registration (see
 * ensureSyncRow), so nothing here has to look for instances without one.
 *
 * An instance whose engine has not called the woofx3 webhook within the
 * inactivity window is pushed out by that window instead of synced: nothing
 * on it has changed for a sync to pick up.
 *
 * A run in flight keeps its row out of the due set: the sweep and startRun
 * move nextEligibleAt to the end of the run's lease. A "running" row that is
 * due again is a run that died without finalizing, and is synced like any
 * other.
 */
export const sweep = internalMutation({
  args: { chainedRun: v.optional(v.number()) },
  handler: async (ctx, { chainedRun = 0 }): Promise<{ scheduled: number; deferred: number }> => {
    const now = Date.now();
    const due = await ctx.db
      .query("instanceSync")
      .withIndex("by_next_eligible", (q) => q.lte("nextEligibleAt", now))
      .take(ENGINE_SYNC_CONFIG.sweepBatchSize);

    let scheduled = 0;
    let deferred = 0;
    for (const row of due) {
      const instance = await ctx.db.get(row.instanceId);
      if (!instance) {
        // Its instance is gone and its nextEligibleAt will never move again,
        // so left in place it would sit at the front of every sweep.
        await ctx.db.delete(row._id);
        continue;
      }
      if (!isEngineActive(instance.lastEngineActivityAt, now)) {
        await ctx.db.patch(row._id, { nextEligibleAt: now + ENGINE_SYNC_CONFIG.inactivityThresholdMs });
        deferred++;
        continue;
      }
      // Claim the row for the run's lease, so a sweep before the run starts
      // does not schedule it again.
      await ctx.db.patch(row._id, { nextEligibleAt: now + ENGINE_SYNC_CONFIG.runLeaseMs });
      await ctx.scheduler.runAfter(0, internal.engineSync.runSync, {
        instanceId: row.instanceId,
        trigger: "scheduled",
      });
      scheduled++;
    }

    // Every row read is now deleted, deferred or claimed, so the next pass
    // reads the rows behind them.
    if (due.length === ENGINE_SYNC_CONFIG.sweepBatchSize && chainedRun < ENGINE_SYNC_CONFIG.sweepMaxChainedRuns) {
      await ctx.scheduler.runAfter(0, internal.engineSync.sweep, { chainedRun: chainedRun + 1 });
    }
    return { scheduled, deferred };
  },
});

/**
 * Reactive query the UI subscribes to. Returns the per-instance sync state,
 * the in-flight run (if any), and the last 5 runs. Returns null unless the
 * caller is a member of the instance.
 */
export const getSyncState = query({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    if (!(await isInstanceMember(ctx, instanceId))) {
      return null;
    }
    return readSyncState(ctx, instanceId, Date.now());
  },
});

/**
 * Manual-trigger action. Bypasses the activity gate (the gate only applies to
 * scheduled sweeps). Rejects if a run is already in flight for this instance;
 * a run past its lease is not in flight (see readSyncState).
 *
 * The "already running" check is a best-effort read just before scheduling —
 * two simultaneous clicks could race past it and schedule two runs. That's
 * acceptable for v1: `runSync` is idempotent at the lifecycle level.
 */
export const syncNow = action({
  args: { instanceId: v.id("instances") },
  handler: async (ctx, { instanceId }) => {
    const userId = await requireInstanceRoleInAction(ctx, instanceId);
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
