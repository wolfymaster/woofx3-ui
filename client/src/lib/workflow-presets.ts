import type { ConfigField, ConfigFieldType, TriggerConfig } from "@woofx3/api/ui-schema";
import type { LucideIcon } from "lucide-react";

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
  /**
   * Engine event type this trigger fires on (e.g. "cheer.user.twitch"). Required
   * to build canonical WorkflowDefinition JSON from a preset; surfaced from
   * the Convex catalog via `useWorkflowCatalog`.
   */
  event?: string;
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

// Canonical WorkflowDefinition generation lives in workflow-presets-json.ts.
// The legacy ReactFlow-shaped generators were removed as part of the JSON-first
// refactor — the engine is now the authority for workflow structure and mints
// its own ids on creation.
