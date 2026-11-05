import { escapeDollarKeys } from "@shared/dollar-keys";
import { internal } from "../../../_generated/api";
import { readAllEngineWorkflows } from "../../engineWorkflows";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * workflowsStep — full-snapshot reconciliation of engine workflows.
 *
 * Pulls the engine's `getWorkflows()` snapshot one page at a time, then
 * forwards the complete set to `internal.engineSyncInternal.reconcileWorkflows`.
 * The engine is the source of truth: locally-cached rows are upserted by
 * `engineWorkflowId` and rows whose id disappears from the snapshot are
 * deleted.
 *
 * Engine `Workflow` shape (see `@woofx3/api`):
 *   { id, name, description, isEnabled, definition, stats, ... }
 * Only `id`, `isEnabled`, and `definition` are mirrored here — the rest
 * lives in the canonical `WorkflowDefinition` JSON. Rows with a null
 * definition are skipped: the workflows table only mirrors canonical
 * definitions, and a null indicates a row in-flight or otherwise not
 * yet usable.
 */
export const workflowsStep: SyncStep = {
  name: "workflows",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const snapshotStartedAt = Date.now();
    const all = await readAllEngineWorkflows(newApi);

    const upserts = all
      .filter((w) => w.definition !== null)
      .map((w) => ({
        engineWorkflowId: w.id,
        definition: escapeDollarKeys(w.definition),
        isEnabled: w.isEnabled,
        groupIds: w.groupIds,
      }));
    const engineIds = all.map((w) => w.id);

    return await ctx.runMutation(internal.engineSyncInternal.reconcileWorkflows, {
      instanceId,
      snapshotStartedAt,
      engineIds,
      upserts,
    });
  },
};
