import type { ConfigField } from "@woofx3/api/ui-schema";
import type { CatalogActionRow, CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { isCommandsSource, parseConfigFields } from "@/lib/parse-config-fields";
import { resolveCatalogAction, resolveCatalogTrigger } from "@/lib/workflow-node-label";
import { formatConfigValue } from "@/lib/workflow-presets";
import { decodeConditionValue } from "@/lib/workflow-presets-json";
import type { ActionNode, TriggerNode } from "@/lib/workflow-tree";

function formatFieldSummaryValue(field: ConfigField, raw: unknown, resourceLabels?: Map<string, string>): string {
  if (raw === null || raw === undefined || raw === "") {
    return "";
  }
  if (field.type === "media" || field.type === "asset") {
    return (raw as { name?: string } | null)?.name ?? "";
  }
  if (field.type === "toggle") {
    return raw ? "On" : "Off";
  }
  if (field.type === "select" && field.options) {
    const match = field.options.find((o) => o.value === raw);
    if (match) {
      return match.label;
    }
  }
  if (field.type === "resource_ref" && typeof raw === "string") {
    return resourceLabels?.get(raw) ?? raw;
  }
  return formatConfigValue(raw as Parameters<typeof formatConfigValue>[0], field.unit);
}

/** Chat-command style triggers fold the picked command into the event suffix, not a condition. */
function commandFieldSummary(
  catalogTrigger: CatalogTriggerRow | undefined,
  node: TriggerNode,
  fields: ConfigField[]
): string[] {
  const commandFields = fields.filter(isCommandsSource);
  const base = catalogTrigger?.event;
  if (commandFields.length !== 1 || !base || !node.event.startsWith(`${base}.`)) {
    return [];
  }
  const value = node.event.slice(base.length + 1);
  return value ? [`${commandFields[0].label}: ${value}`] : [];
}

/** Configured-value summary lines for a trigger step, for display without opening its settings. */
export function triggerNodeSummary(
  node: TriggerNode,
  catalog: CatalogTriggerRow[],
  resourceLabels?: Map<string, string>
): string[] {
  const catalogTrigger = resolveCatalogTrigger(node, catalog);
  const fields = parseConfigFields(catalogTrigger?.configFields);
  if (fields.length === 0) {
    return [];
  }
  const parts = commandFieldSummary(catalogTrigger, node, fields);
  for (const field of fields) {
    const formatted = formatFieldSummaryValue(field, decodeConditionValue(field, node.conditions), resourceLabels);
    if (formatted) {
      parts.push(`${field.label}: ${formatted}`);
    }
  }
  return parts;
}

/** Configured-value summary lines for an action step, for display without opening its settings. */
export function actionNodeSummary(
  node: ActionNode,
  catalog: CatalogActionRow[],
  resourceLabels?: Map<string, string>
): string[] {
  const catalogAction = resolveCatalogAction(node, catalog);
  const fields = parseConfigFields(catalogAction?.configFields);
  if (fields.length === 0) {
    return [];
  }
  const parts: string[] = [];
  for (const field of fields) {
    const formatted = formatFieldSummaryValue(field, node.parameters[field.id], resourceLabels);
    if (formatted) {
      parts.push(`${field.label}: ${formatted}`);
    }
  }
  return parts;
}
