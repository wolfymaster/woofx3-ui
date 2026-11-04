import { ENGINE_CAPABILITIES } from "@woofx3/api";
import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * workflowGroupsStep — full-snapshot reconciliation of workflow groups
 * (alert groups). An engine without `workflows.groups` has none to read, so
 * the step asks for the capability first and leaves the mirror alone without
 * it.
 */
export const workflowGroupsStep: SyncStep = {
  name: "workflowGroups",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const { capabilities } = await newApi().getEngineCapabilities();
    if (!capabilities.includes(ENGINE_CAPABILITIES.workflowsGroups)) {
      return { itemsProcessed: 0 };
    }
    const snapshotStartedAt = Date.now();
    const groups = await newApi().listWorkflowGroups();
    return await ctx.runMutation(internal.engineSyncInternal.reconcileWorkflowGroups, {
      instanceId,
      snapshotStartedAt,
      snapshots: groups.map((g) => ({
        engineGroupId: g.id,
        name: g.name,
        description: g.description,
        enabled: g.enabled,
        memberIds: g.memberIds,
      })),
    });
  },
};
