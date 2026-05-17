import { internal } from "../../../_generated/api";
import type { EngineApi } from "../../engineInstanceUrl";
import { ENGINE_SYNC_CONFIG } from "../config";
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
 *   { id, name, description, accountId, isEnabled, definition, stats, ... }
 * Only `id`, `isEnabled`, and `definition` are mirrored here — the rest
 * lives in the canonical `WorkflowDefinition` JSON. Rows with a null
 * definition are skipped: the workflows table only mirrors canonical
 * definitions, and a null indicates a row in-flight or otherwise not
 * yet usable.
 */
export const workflowsStep: SyncStep = {
  name: "workflows",
  run: async ({ ctx, newApi, instanceId, applicationId }: SyncStepContext) => {
    type WfPage = Awaited<ReturnType<EngineApi["getWorkflows"]>>;
    const all: WfPage["workflows"] = [];
    let page = 1;
    while (true) {
      // Each page is a separate engine RPC — capnweb sessions are single-use,
      // so we must open a fresh session per page.
      const api = newApi();
      const res = (await api.getWorkflows({
        accountId: applicationId,
        page,
        pageSize: ENGINE_SYNC_CONFIG.pageSize,
      })) as WfPage;
      const wfs = res.workflows ?? [];
      all.push(...wfs);
      if (wfs.length < ENGINE_SYNC_CONFIG.pageSize) {
        break;
      }
      page++;
      if (page > 1000) {
        throw new Error("Workflow pagination exceeded 1000 pages — aborting to avoid runaway");
      }
    }

    const upserts = all
      .filter((w) => w.definition !== null)
      .map((w) => ({
        engineWorkflowId: w.id,
        definition: w.definition,
        isEnabled: w.isEnabled,
      }));
    const engineIds = all.map((w) => w.id);

    return await ctx.runMutation(internal.engineSyncInternal.reconcileWorkflows, {
      instanceId,
      applicationId,
      engineIds,
      upserts,
    });
  },
};
