import type { TriggerDefinition } from "@woofx3/api/webhooks";
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
    const snapshots = (raw ?? []).map(triggerSnapshot);
    return await ctx.runMutation(internal.engineSyncInternal.reconcileTriggers, {
      instanceId,
      snapshots,
    });
  },
};

/**
 * The fields of an engine trigger that `reconcileTriggers` accepts.
 *
 * Every field the catalog row is built from has to be carried here: the sync
 * patches the row the registration webhook wrote, so a field dropped here is
 * erased from it. A bundled module installs when the engine boots, before the
 * UI has registered for webhooks, so the sync is the only writer its triggers
 * may ever get.
 */
export function triggerSnapshot(t: TriggerDefinition) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    event: t.event,
    configSchema: t.configSchema,
    emits: t.emits,
    sentence: t.sentence,
    allowVariants: t.allowVariants,
    projectionKey: t.projectionKey,
    taxonomy: t.taxonomy,
    createdByType: t.createdByType,
    createdByRef: t.createdByRef,
    transport: t.transport,
  };
}
