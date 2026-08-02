import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * resourcesStep — full-snapshot reconciliation of module resource instances.
 *
 * Calls `listAllResourceInstances()` to get every resource instance across
 * every installed module on the engine, then forwards the snapshot to
 * `internal.engineSyncInternal.reconcileResourceInstances`. Self-healing
 * counterpart to the `MODULE_RESOURCE_INSTANCE_CREATED`/`_DELETED` webhook
 * path — backfills/corrects `moduleResourceInstances` even if a webhook was
 * ever missed or (before the moduleKey fix) misresolved.
 */
export const resourcesStep: SyncStep = {
  name: "resources",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const api = newApi();
    const snapshots = await api.listAllResourceInstances();
    return await ctx.runMutation(internal.engineSyncInternal.reconcileResourceInstances, { instanceId, snapshots });
  },
};
