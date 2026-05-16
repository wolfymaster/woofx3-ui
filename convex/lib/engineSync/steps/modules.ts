import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * modulesStep — full-snapshot reconciliation of installed engine modules.
 *
 * Pulls the engine's `listEngineModules()` snapshot and forwards it to
 * `internal.engineSyncInternal.reconcileModules`. The engine is the
 * source of truth: locally-cached rows are upserted by `name` and rows
 * whose name disappears from the snapshot are deleted.
 *
 * Engine return type is `EngineModuleSummary` (see `@woofx3/api`) with
 * required fields `{ name, version, state }`. Defensive fallbacks here
 * guard against partial responses from older engines.
 */
export const modulesStep: SyncStep = {
  name: "modules",
  run: async ({ ctx, api, instanceId }: SyncStepContext) => {
    const snapshots = await api.listEngineModules();
    const safe = (snapshots ?? [])
      .filter((m) => !!m.name)
      .map((m) => ({
        name: m.name ?? "",
        version: m.version ?? "",
        state: m.state ?? "active",
      }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileModules, {
      instanceId,
      snapshots: safe,
    });
  },
};
