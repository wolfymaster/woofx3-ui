import { parseFieldList } from "@woofx3/api/ui-schema";
import { internal } from "../../../_generated/api";
import { widgetCanonicalKey } from "../../widgetKey";
import type { SyncStep, SyncStepContext } from "../steps";

/**
 * widgetsStep — full-snapshot reconciliation of engine widgets.
 *
 * Calls `getAvailableWidgets()` to get all widgets registered in the engine,
 * parses each widget's `settingsSchema` JSON string with the shared field
 * parser — the same one trigger and action schemas use — into ConfigFields,
 * then forwards snapshots to `internal.engineSyncInternal.reconcileWidgets`.
 *
 * `moduleWidgets` is the global definition catalog (upserted by `widgetId`, never
 * deleted here — `MODULE_WIDGET_DEREGISTERED` handles removal). Per-instance
 * placement is reconciled into `instanceWidgets`. Built-in widgets (createdByType
 * "SYSTEM", no module) are included — they are not skipped.
 */
export const widgetsStep: SyncStep = {
  name: "widgets",
  run: async ({ ctx, newApi, instanceId }: SyncStepContext) => {
    const api = newApi();
    const res = await api.getAvailableWidgets();
    const snapshots = (res.widgets ?? []).map((w) => ({
      // Key on the canonical projectionKey, derived from createdByRef + manifestId
      // (getAvailableWidgets omits projectionKey). Must match the webhook path's key.
      id: widgetCanonicalKey({ createdByRef: w.createdByRef, manifestId: w.manifestId, id: w.id }),
      name: w.name,
      directory: w.directory,
      description: w.description || undefined,
      alertTypes: w.alertTypes,
      settings: parseFieldList(w.settingsSchema),
      createdByType: w.createdByType,
      createdByRef: w.createdByRef,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileWidgets, { instanceId, snapshots });
  },
};
