import { internal } from "../../../_generated/api";
import { escapeDollarKeys } from "../../dollarKeys";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * commandsStep — full-snapshot reconciliation of chat commands.
 *
 * Pulls the engine's `listCommands()` snapshot and forwards it to
 * `internal.engineSyncInternal.reconcileCommands`. The engine is the
 * source of truth: locally-cached rows are upserted by `engineCommandId`
 * and rows whose engine id disappears are deleted.
 */
export const commandsStep: SyncStep = {
  name: "commands",
  run: async ({ ctx, newApi, instanceId, applicationId }: SyncStepContext) => {
    const api = newApi();
    const snapshots = await api.listCommands();
    const safe = (snapshots ?? []).map((s) => ({
      engineCommandId: s.id,
      command: s.command,
      // Escaped like every other engine JSON Convex stores: an action's `$ref`
      // is a reserved field name there (see lib/dollarKeys.ts).
      actions: escapeDollarKeys(s.actions ?? []) as unknown[],
      cooldown: s.cooldown,
      priority: s.priority,
      enabled: s.enabled,
      visibility: s.visibility,
      groupIds: s.groupIds ?? [],
      usernames: s.usernames ?? [],
      argumentPattern: s.argumentPattern ?? "",
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileCommands, {
      instanceId,
      applicationId,
      snapshots: safe,
    });
  },
};
