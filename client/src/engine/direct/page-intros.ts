import type { PageIntrosGateway } from "@/engine/gateway";
import { useEngineQuery, useEngineRequest } from "./query";
import type { DirectRuntime } from "./runtime";
import { putUISetting, UI_SETTING_NAMESPACES, uiSettingsRead } from "./ui-settings";

/** One setting per closed intro, keyed by its id; the value only marks it closed. */
const DISMISSED = true;

const dismissedIds = (settings: { key: string }[]): readonly string[] => settings.map((setting) => setting.key);

export function directPageIntrosGateway(runtime: DirectRuntime): PageIntrosGateway {
  const read = uiSettingsRead(runtime, UI_SETTING_NAMESPACES.pageIntros, "pageIntros.useDismissed");
  const dismiss = (introId: string) =>
    putUISetting(runtime, UI_SETTING_NAMESPACES.pageIntros, introId, DISMISSED, "pageIntros.useDismissRequest");
  return {
    useDismissed: () => useEngineQuery(runtime, read, { select: dismissedIds }),
    useDismissRequest: () => useEngineRequest(dismiss),
  };
}
