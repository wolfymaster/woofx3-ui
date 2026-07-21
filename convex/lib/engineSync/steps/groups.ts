import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * groupsStep — full-snapshot reconciliation of chat command groups
 * ("user groups"/roles) and their membership rosters.
 *
 * Pulls the engine's `listGroups()` snapshot, then `listGroupMembers(id)`
 * per group (there is no bulk membership endpoint — see
 * docs/services/commands-ui.md in the woofx3 engine repo), and forwards the
 * combined result to `internal.engineSyncInternal.reconcileGroups`.
 */
export const groupsStep: SyncStep = {
  name: "groups",
  run: async ({ ctx, newApi, instanceId, applicationId }: SyncStepContext) => {
    const groups = (await newApi().listGroups()) ?? [];
    const safe = [];
    for (const g of groups) {
      // Each listGroupMembers call needs its own capnweb session (see
      // SyncStepContext.newApi doc — sessions are single-use per round-trip).
      const members = await newApi().listGroupMembers(g.id);
      safe.push({
        engineGroupId: g.id,
        name: g.name,
        description: g.description,
        engineCreatedAt: g.createdAt,
        members: members ?? [],
      });
    }
    return await ctx.runMutation(internal.engineSyncInternal.reconcileGroups, {
      instanceId,
      applicationId,
      snapshots: safe,
    });
  },
};
