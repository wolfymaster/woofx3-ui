import type { ConfigField } from "@woofx3/api/ui-schema";
import { stackOrder } from "@woofx3/scene/model";
import type { CatalogTriggerRow } from "@/hooks/use-workflow-catalog";
import { alertCompositionOf } from "@/lib/alert-layout";
import { toMediaValue } from "@/lib/media-value";
import { isCommandsSource, parseConfigFields } from "@/lib/parse-config-fields";
import { resolveCatalogTrigger } from "@/lib/workflow-node-label";
import { formatConfigValue } from "@/lib/workflow-presets";
import { ANY_CONDITION, decodeConditionValue } from "@/lib/workflow-presets-json";
import type { TriggerNode } from "@/lib/workflow-tree";

function formatFieldSummaryValue(field: ConfigField, raw: unknown, resourceLabels?: Map<string, string>): string {
  if (raw === null || raw === undefined || raw === "") {
    return "";
  }
  if (field.type === "media" || field.type === "asset") {
    return toMediaValue(raw)?.name ?? "";
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
  if (field.type === "layout") {
    return alertLayoutSummary(raw);
  }
  if (field.type === "resource_ref" && typeof raw === "string") {
    return resourceLabels?.get(raw) ?? raw;
  }
  return formatConfigValue(raw as Parameters<typeof formatConfigValue>[0], field.unit);
}

const SUMMARY_TEXT_LENGTH = 40;

/**
 * An alert layout in a few words: the topmost text, with its variables shown by
 * their last segment as text fields show them, and how many layers it has.
 */
export function alertLayoutSummary(raw: unknown): string {
  const doc = alertCompositionOf(raw);
  if (doc === null) {
    return "";
  }
  const order = stackOrder(doc).reverse();
  if (order.length === 0) {
    return "Empty";
  }
  const layers = `${order.length} ${order.length === 1 ? "layer" : "layers"}`;
  const text = order
    .map((id) => doc.widgets[id]?.settings.text)
    .find((value): value is string => typeof value === "string" && value.trim() !== "");
  if (text === undefined) {
    return layers;
  }
  const shown = text.trim().replace(/\$\{([^{}]*)\}/g, (_match, path: string) => `{${path.split(".").pop()}}`);
  const clipped = shown.length > SUMMARY_TEXT_LENGTH ? `${shown.slice(0, SUMMARY_TEXT_LENGTH - 1)}…` : shown;
  return `“${clipped}” · ${layers}`;
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
    const decoded = decodeConditionValue(field, node.conditions);
    const formatted = decoded === ANY_CONDITION ? "any" : formatFieldSummaryValue(field, decoded, resourceLabels);
    if (formatted) {
      parts.push(`${field.label}: ${formatted}`);
    }
  }
  return parts;
}
