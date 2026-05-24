import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * actionsStep — full-snapshot reconciliation of engine actions.
 *
 * Calls `getActions()` (no filter = all actions for this application), then
 * forwards the complete set to `internal.engineSyncInternal.reconcileActions`.
 * The engine is the source of truth for which actions are live:
 * `instanceActions` rows whose `actionId` disappears are deleted.
 * `actionDefinitions` rows are only upserted (never deleted) because the
 * catalog is global and an action absent from one instance may still be
 * registered on another.
 */
export const actionsStep: SyncStep = {
  name: "actions",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const api = newApi();
    const raw = await api.getActions();
    const snapshots = (raw ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      paramsSchema: a.paramsSchema,
      projectionKey: a.projectionKey,
      createdByType: a.createdByType,
      createdByRef: a.createdByRef,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileActions, {
      instanceId,
      snapshots,
    });
  },
};
