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
    const snapshots = await newApi().listAllResourceInstances();
    const result = await ctx.runMutation(internal.engineSyncInternal.reconcileResourceInstances, {
      instanceId,
      snapshots,
    });
    // Each capnweb batch session is single-use, so the value read needs its own.
    if (snapshots.length > 0) {
      const values = await newApi().getResourceValues(snapshots.map((snapshot) => snapshot.canonicalId));
      await ctx.runMutation(internal.resourceValues.upsertMany, { instanceId, values });
    }
    return result;
  },
};
