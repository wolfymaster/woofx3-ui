import { ENGINE_CAPABILITIES, type UISetting, type UISettingValue, type UISettingWriteResult } from "@woofx3/api";
import { GatewayUnsupportedError } from "@/engine/errors";
import { directKeys as k } from "./keys";
import type { EngineRead } from "./query";
import type { DirectRuntime } from "./runtime";

// The dashboard's own data (page intros, layouts, notes, counters, macros)
// kept by the engine for a dashboard with no account: one namespace per kind
// of data, the engine storing values it never reads. Each namespace is read
// whole and cached; `ui.setting.changed` refreshes it, whichever window or
// device wrote. Rules for revisions and conflicts:
// docs/services/local-ui-settings.md in the engine repository.

/** Names the namespaces the dashboard keeps, so no two features share one by accident. */
export const UI_SETTING_NAMESPACES = {
  pageIntros: "pageIntros",
  dashboardLayouts: "dashboardLayouts",
  dashboardNotes: "dashboardNotes",
  dashboardCounters: "dashboardCounters",
  dashboardHighlights: "dashboardHighlights",
  macros: "macros",
} as const;

export type UISettingNamespace = (typeof UI_SETTING_NAMESPACES)[keyof typeof UI_SETTING_NAMESPACES];

function requireUISettings(runtime: DirectRuntime, member: string): void {
  if (!runtime.supports(ENGINE_CAPABILITIES.uiSettings)) {
    throw new GatewayUnsupportedError(member);
  }
}

/** Every live setting in `namespace`; tombstones are left out by the engine. */
export function uiSettingsRead(
  runtime: DirectRuntime,
  namespace: UISettingNamespace,
  member: string
): EngineRead<UISetting[]> {
  return {
    queryKey: k.uiSettings.namespace(namespace),
    queryFn: async () => {
      requireUISettings(runtime, member);
      return runtime.call("listUISettings", (api) => api.listUISettings(namespace));
    },
  };
}

/**
 * Writes one setting unconditionally and refreshes its namespace. For data
 * where the last write simply wins, such as a flag set once.
 */
export async function putUISetting(
  runtime: DirectRuntime,
  namespace: UISettingNamespace,
  key: string,
  value: UISettingValue,
  member: string
): Promise<void> {
  requireUISettings(runtime, member);
  const result = await runtime.call("setUISetting", (api) => api.setUISetting(namespace, key, value));
  if (!result.ok) {
    throw new Error(`${member}: the engine refused an unconditional write to ${namespace}/${key}`);
  }
  await runtime.queryClient.invalidateQueries({ queryKey: k.uiSettings.namespace(namespace) });
}

/** What a read-modify-write makes of a setting: a value to store, or no write at all. */
export type UISettingUpdate = { kind: "write"; value: UISettingValue } | { kind: "keep" };

/**
 * Puts what the engine answered for a write into the namespace's cached
 * read, so the write resolves only once screens can see it, as a Convex
 * mutation does. The `ui.setting.changed` the write causes reads the
 * namespace again anyway.
 */
function cacheWritten(runtime: DirectRuntime, setting: UISetting): void {
  runtime.queryClient.setQueryData<UISetting[]>(k.uiSettings.namespace(setting.namespace), (list) => {
    if (list === undefined) {
      return undefined;
    }
    const others = list.filter((cached) => cached.key !== setting.key);
    return setting.deleted ? others : [...others, setting];
  });
}

/** A conflict's stored setting as a read sees it: a tombstone is no setting. */
function liveOrNull(setting: UISetting | null): UISetting | null {
  return setting && !setting.deleted ? setting : null;
}

/**
 * Reads `key`, asks `update` what to store given what is there (null: no live
 * value), and writes it only if no other write landed in between, by the
 * revision it read. On a conflict `update` runs again on the setting the
 * engine answered with, up to `config.uiSettingWriteAttempts` tries in all;
 * then it rejects rather than overwrite a change it never saw. Resolves with
 * the setting as stored, or as read when `update` keeps it.
 */
export async function updateUISetting(
  runtime: DirectRuntime,
  namespace: UISettingNamespace,
  key: string,
  update: (current: UISetting | null) => UISettingUpdate,
  member: string
): Promise<UISetting | null> {
  requireUISettings(runtime, member);
  let current = await runtime.call("getUISetting", (api) => api.getUISetting(namespace, key));
  for (let attempt = 1; attempt <= runtime.config.uiSettingWriteAttempts; attempt += 1) {
    const next = update(current);
    if (next.kind === "keep") {
      return current;
    }
    const expectedRevision = current?.revision ?? 0;
    const result: UISettingWriteResult = await runtime.call("setUISetting", (api) =>
      api.setUISetting(namespace, key, next.value, expectedRevision)
    );
    if (result.ok) {
      cacheWritten(runtime, result.setting);
      return result.setting;
    }
    current = liveOrNull(result.current);
  }
  throw new Error(
    `${member}: ${namespace}/${key} kept changing while it was written; gave up after ${runtime.config.uiSettingWriteAttempts} tries`
  );
}

/** Deletes one setting unconditionally, leaving the engine's tombstone; deleting one already gone is no error. */
export async function removeUISetting(
  runtime: DirectRuntime,
  namespace: UISettingNamespace,
  key: string,
  member: string
): Promise<void> {
  requireUISettings(runtime, member);
  const result = await runtime.call("deleteUISetting", (api) => api.deleteUISetting(namespace, key));
  if (!result.ok) {
    throw new Error(`${member}: the engine refused an unconditional delete of ${namespace}/${key}`);
  }
  cacheWritten(runtime, result.setting);
}
