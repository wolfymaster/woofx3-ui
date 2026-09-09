import type { ConfigField, ConfigFieldType, DataShapeField } from "@woofx3/api/ui-schema";
import type { LucideIcon } from "lucide-react";

/**
 * A preset's configuration surface: the fields plus whether the user may
 * create multiple bound instances of the trigger.
 *
 * Declared here rather than imported. The engine contract has no such
 * container any more — a field declaration is a bare array, and this pairing
 * only exists because a *preset* bundles a trigger with its form. Keeping it
 * local also ends the long-standing name clash with the workflow-definition
 * `TriggerConfig`, which is a completely different thing.
 */
export interface TriggerConfig {
  fields: ConfigField[];
  allowVariants?: boolean;
}

export type { ConfigField };
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
  /** Engine row id (UUID) — used for instance enablement only. */
  id: string;
  /** Canonical trigger ref for workflow JSON `$ref` (e.g. `twitch_platform:trigger:cheer.user.twitch`). */
  canonicalRef?: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  color: string;
  event?: string;
  config?: TriggerConfig;
}

export interface ActionPreset {
  /** Engine row id (UUID) — used for instance enablement only. */
  id: string;
  /** Canonical action ref for workflow JSON `$ref` (e.g. `twitch_platform:action:twitch.chat.send`). */
  canonicalRef?: string;
  /** Workflow engine handler name (e.g. `function`, `alert`). */
  handlerType?: string;
  /** Canonical function id when `handlerType` is `function`. */
  functionCall?: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
  color: string;
  config?: {
    fields: ConfigField[];
    /** DataShapeField[] naming what this action's function hands back (e.g. {next, previous}).
     * Backs the workflow builder's ${stepId.field} variable autocomplete. */
    outputs?: DataShapeField[];
  };
}

export interface TriggerVariant {
  id: string;
  /** User-visible label for this binding (defaults from trigger name + config values). */
  displayName: string;
  /** When true, changing trigger field values does not overwrite displayName. */
  displayNameCustomized?: boolean;
  values: TriggerConfigValues;
  action: ActionPreset | null;
  actionConfig: TriggerConfigValues;
}

/** @deprecated Use TriggerVariant */
export type TierConfig = TriggerVariant;

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
