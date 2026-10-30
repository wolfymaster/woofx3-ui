import { ENGINE_CAPABILITIES, type UISetting, type UISettingValue } from "@woofx3/api";
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
