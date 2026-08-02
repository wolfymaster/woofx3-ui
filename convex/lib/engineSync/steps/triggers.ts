import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * triggersStep — full-snapshot reconciliation of engine triggers.
 *
 * Calls the engine's `getTriggers()` (no filter = all triggers for this
 * application), then forwards the complete set to
 * `internal.engineSyncInternal.reconcileTriggers`. The engine is the source
 * of truth for which triggers are live: `instanceTriggers` rows whose
 * `triggerId` disappears from the snapshot are deleted. `triggerDefinitions`
 * rows are only upserted (never deleted) because the catalog is global and
 * a trigger missing from one instance may still be registered on another.
 */
export const triggersStep: SyncStep = {
  name: "triggers",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const api = newApi();
    const raw = await api.getTriggers();
    const snapshots = (raw ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      event: t.event,
      configSchema: t.configSchema,
      allowVariants: t.allowVariants,
      projectionKey: t.projectionKey,
      createdByType: t.createdByType,
      createdByRef: t.createdByRef,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileTriggers, {
      instanceId,
      snapshots,
    });
  },
};
