import type { ModuleResourceInstance } from "@/engine/types";

/** What to call the instance. Falls back to its id, which is always set, so a card is never blank. */
export function resourceName(row: ModuleResourceInstance): string {
  return row.displayName || row.resourceInstanceId;
}

/**
 * The instance's own settings — its kind's `schema` field values. Stored as
 * `v.any()` and absent on rows mirrored before instances carried settings, so
 * anything but an object reads as none.
 */
export function resourceSettings(row: ModuleResourceInstance): Record<string, unknown> {
  const settings = row.settings;
  return settings && typeof settings === "object" && !Array.isArray(settings)
    ? (settings as Record<string, unknown>)
    : {};
}
