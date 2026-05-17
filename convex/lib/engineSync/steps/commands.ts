import { internal } from "../../../_generated/api";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * commandsStep — full-snapshot reconciliation of chat commands.
 *
 * Pulls the engine's `listCommands()` snapshot and forwards it to
 * `internal.engineSyncInternal.reconcileCommands`. The engine is the
 * source of truth: locally-cached rows are upserted by `engineCommandId`
 * and rows whose engine id disappears are deleted.
 *
 * The engine's `CommandSnapshot` (see `@woofx3/api`) keeps the
 * type-discriminated payload in a single `typeValue` string. Legacy
 * Convex-side fields (`response` / `template` / `functionId`) are not
 * part of the snapshot and are intentionally not mapped here.
 */
export const commandsStep: SyncStep = {
  name: "commands",
  run: async ({ ctx, newApi, instanceId, applicationId }: SyncStepContext) => {
    const api = newApi();
    const snapshots = await api.listCommands();
    const safe = (snapshots ?? []).map((s) => ({
      engineCommandId: s.id,
      command: s.command,
      type: s.type,
      typeValue: s.typeValue,
      cooldown: s.cooldown,
      priority: s.priority,
      enabled: s.enabled,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileCommands, {
      instanceId,
      applicationId,
      snapshots: safe,
    });
  },
};
