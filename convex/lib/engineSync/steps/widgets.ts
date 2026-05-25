import { internal } from "../../../_generated/api";
import { widgetCanonicalKey } from "../../widgetKey";
import type { SyncStep, SyncStepContext } from "../steps";

type WidgetSetting = {
  key: string;
  fieldType: string;
  label: string;
  defaultValue: unknown;
  options?: Array<{ label: string; value: string }>;
};

function parseWidgetSettings(schemaJson: string): WidgetSetting[] {
  try {
    const arr = JSON.parse(schemaJson);
    if (!Array.isArray(arr)) {
      return [];
    }
    return arr.map((item: Record<string, unknown>) => ({
      key: String(item.key ?? ""),
      fieldType: String(item.fieldType ?? "text"),
      label: String(item.label ?? ""),
      defaultValue: item.defaultValue ?? null,
      options: Array.isArray(item.options) ? (item.options as Array<{ label: string; value: string }>) : undefined,
    }));
  } catch {
    return [];
  }
}

/**
 * widgetsStep — full-snapshot reconciliation of engine widgets.
 *
 * Calls `getAvailableWidgets()` to get all widgets registered in the engine,
 * parses each widget's `settingsSchema` JSON string into a structured array,
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
      settings: parseWidgetSettings(w.settingsSchema),
      createdByType: w.createdByType,
      createdByRef: w.createdByRef,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileWidgets, { instanceId, snapshots });
  },
};
