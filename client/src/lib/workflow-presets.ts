import type { LucideIcon } from "lucide-react";
import type {
  ConfigField,
  ConfigFieldType,
  TriggerConfig,
} from "@woofx3/api/ui-schema";

// ConfigField / TriggerConfig are the shared parsed shape of configSchema.
// Re-export them here so UI code keeps the same import site; additional
// UI-only types (TriggerPreset, ConfigValue, etc.) remain defined below.
export type { ConfigField, TriggerConfig };
export type FieldType = ConfigFieldType;

export interface ConfigValue {
  type: "single" | "range";
  value?: number;
  min?: number;
  max?: number;
}

export interface TriggerConfigValues {
  [fieldId: string]: string | number | boolean | ConfigValue | null;
}

export interface TriggerPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  color: string;
  config?: TriggerConfig;
}

export interface ActionPreset {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  color: string;
  config?: {
    fields: ConfigField[];
  };
}

export interface TierConfig {
  id: string;
  values: TriggerConfigValues;
  action: ActionPreset | null;
  actionConfig: TriggerConfigValues;
}

// Trigger and action presets are now loaded dynamically from Convex via useWorkflowCatalog().
// See convex/workflowCatalog.ts and client/src/hooks/use-workflow-catalog.ts.

export function getDefaultConfigValues(fields: ConfigField[]): TriggerConfigValues {
  const values: TriggerConfigValues = {};
  fields.forEach((field) => {
    if (field.defaultValue !== undefined) {
      values[field.id] = field.defaultValue as TriggerConfigValues[string];
    } else if (field.type === "range") {
      values[field.id] = { type: "single", value: field.min || 1 };
    } else if (field.type === "number") {
      values[field.id] = field.min || 0;
    } else if (field.type === "toggle") {
      values[field.id] = false;
    } else {
      values[field.id] = "";
    }
  });
  return values;
}

export function formatConfigValue(value: ConfigValue | number | string | boolean | null, unit?: string): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && "type" in value) {
    const cv = value as ConfigValue;
    if (cv.type === "single") {
      return `${cv.value}${unit ? ` ${unit}` : ""}`;
    } else {
      return `${cv.min}-${cv.max}${unit ? ` ${unit}` : ""}`;
    }
  }

  return `${value}${unit ? ` ${unit}` : ""}`;
}

export function generateWorkflowFromPresets(
  trigger: TriggerPreset,
  action: ActionPreset,
  triggerConfig?: TriggerConfigValues,
  actionConfig?: TriggerConfigValues,
): { name: string; description: string; nodes: any[]; edges: any[] } {
  const name = `${trigger.name} \u2192 ${action.name}`;
  const description = `When ${trigger.description.toLowerCase()}, ${action.description.toLowerCase()}.`;

  const nodes = [
    {
      id: "trigger-node",
      type: "trigger",
      position: { x: 100, y: 100 },
      data: {
        label: trigger.name,
        triggerId: trigger.id,
        category: trigger.category,
        config: triggerConfig || {},
      },
    },
    {
      id: "action-node",
      type: "action",
      position: { x: 400, y: 100 },
      data: {
        label: action.name,
        actionId: action.id,
        category: action.category,
        config: actionConfig || {},
      },
    },
  ];

  const edges = [
    {
      id: "edge-1",
      source: "trigger-node",
      target: "action-node",
      type: "smoothstep",
    },
  ];

  return { name, description, nodes, edges };
}

export function generateMultiTierWorkflow(
  trigger: TriggerPreset,
  tiers: TierConfig[],
): { name: string; description: string; nodes: any[]; edges: any[] } {
  const tierLabels = tiers.map((t) => {
    const amount = t.values.amount as ConfigValue;
    if (amount?.type === "range") {
      return `${amount.min}-${amount.max}`;
    }
    return amount?.value?.toString() || "?";
  });

  const name = `${trigger.name} Automation (${tierLabels.join(", ")} ${trigger.config?.tierLabel || ""})`;
  const description = `Multi-tier ${trigger.name.toLowerCase()} automation with ${tiers.length} trigger${tiers.length > 1 ? "s" : ""}.`;

  const nodes: any[] = [];
  const edges: any[] = [];
  const ySpacing = 140;

  tiers.forEach((tier, index) => {
    const yPos = 100 + index * ySpacing;
    const triggerId = `trigger-node-${index}`;
    const actionId = `action-node-${index}`;

    const amount = tier.values.amount as ConfigValue;
    const labelSuffix =
      amount?.type === "range"
        ? `${amount.min}-${amount.max} ${trigger.config?.tierLabel || ""}`
        : `${amount?.value || "?"} ${trigger.config?.tierLabel || ""}`;

    nodes.push({
      id: triggerId,
      type: "trigger",
      position: { x: 100, y: yPos },
      data: {
        label: `${trigger.name} (${labelSuffix})`,
        triggerId: trigger.id,
        category: trigger.category,
        config: tier.values,
      },
    });

    if (tier.action) {
      nodes.push({
        id: actionId,
        type: "action",
        position: { x: 450, y: yPos },
        data: {
          label: tier.action.name,
          actionId: tier.action.id,
          category: tier.action.category,
          config: tier.actionConfig,
        },
      });

      edges.push({
        id: `edge-${index}`,
        source: triggerId,
        target: actionId,
        type: "smoothstep",
      });
    }
  });

  return { name, description, nodes, edges };
}
