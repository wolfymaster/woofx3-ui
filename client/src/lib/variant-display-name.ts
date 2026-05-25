import type { ConfigField } from "@woofx3/api/ui-schema";
import type { TriggerConfigValues, TriggerPreset } from "@/lib/workflow-presets";
import { formatConfigValue } from "@/lib/workflow-presets";

function formatFieldValue(field: ConfigField, raw: TriggerConfigValues[string]): string {
  if (raw === null || raw === undefined || raw === "") {
    return "";
  }
  return formatConfigValue(raw as Parameters<typeof formatConfigValue>[0], field.unit);
}

/** Build a default UI label from trigger name + configured schema values. */
export function suggestVariantDisplayName(
  trigger: TriggerPreset,
  values: TriggerConfigValues,
  existingNames: string[]
): string {
  const parts: string[] = [];
  for (const field of trigger.config?.fields ?? []) {
    const formatted = formatFieldValue(field, values[field.id]);
    if (formatted) {
      parts.push(formatted);
    }
  }

  let base = trigger.name;
  if (parts.length > 0) {
    base = `${trigger.name} — ${parts.join(", ")}`;
  }

  let name = base;
  let suffix = 2;
  while (existingNames.includes(name)) {
    name = `${base} (${suffix})`;
    suffix++;
  }
  return name;
}
