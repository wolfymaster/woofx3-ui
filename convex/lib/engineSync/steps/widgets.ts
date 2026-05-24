import { internal } from "../../../_generated/api";
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
 * `moduleWidgets` is a global table (no `instanceId`). The reconciler upserts
 * by `widgetId` and skips any widget whose module cannot be resolved in
 * Convex (the webhook path will cover those when the module installs).
 * No rows are deleted — `MODULE_WIDGET_DEREGISTERED` webhooks handle removal.
 */
export const widgetsStep: SyncStep = {
  name: "widgets",
  run: async ({ ctx, newApi }: SyncStepContext) => {
    const api = newApi();
    const res = await api.getAvailableWidgets();
    const snapshots = (res.widgets ?? []).map((w) => ({
      id: w.id,
      name: w.name,
      directory: w.directory,
      description: w.description || undefined,
      alertTypes: w.alertTypes,
      settings: parseWidgetSettings(w.settingsSchema),
      createdByType: w.createdByType,
      createdByRef: w.createdByRef,
    }));
    return await ctx.runMutation(internal.engineSyncInternal.reconcileWidgets, { snapshots });
  },
};
