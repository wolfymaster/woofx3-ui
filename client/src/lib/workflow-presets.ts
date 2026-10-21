import type { ConfigField, ConfigFieldType, DataShapeField } from "@woofx3/api/ui-schema";
import type { LucideIcon } from "lucide-react";
import { formatAmount } from "@/lib/amount-unit";
import {
  type ComparisonValue,
  comparisonChoices,
  defaultComparison,
  formatComparison,
  isComparisonValue,
} from "@/lib/condition-comparison";

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
  [fieldId: string]: string | number | boolean | ConfigValue | ComparisonValue | null;
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
  /**
   * Declared classification axes, e.g. `["platform.twitch", "alert.follow"]`.
   * The `platform.*` and `alert.*` axes place this trigger in the Alerts menu; see
   * `alert-groups.ts`.
   */
  taxonomy?: string[];
  config?: TriggerConfig;
  /**
   * How a configured trigger reads, e.g. `"{reward} is redeemed"`, with `{fieldId}` where
   * a condition value goes. Declared by the module; see lib/condition-sentence.ts.
   */
  sentence?: string;
  /** What `trigger.data` carries when this fires; seeds the Alerts test sheet's payload. */
  emits?: DataShapeField[];
  /**
   * How a fired event reads in the alert feed, e.g. `"{userName} redeemed {rewardTitle}"`,
   * with `{path}` naming a field of `emits`. Declared by the module; see lib/alert-summary.ts.
   */
  summary?: string;
  /** Short secondary lines under the summary, e.g. `"{streakMonths}-month streak"`; same placeholders. */
  summaryDetails?: string[];
  /**
   * The manifest trigger `type`: `"eventbus"` for a trigger fired by an event, absent
   * from engines that predate the field (read it as `"eventbus"`).
   */
  transport?: string;
  /** The module providing this trigger, by its display name; the Events widget groups by it. */
  source?: string;
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
  /** The module providing this action, by its display name; the action picker groups by it. */
  source: string;
  /** Declared classification axes, e.g. `["system.workflow"]` — see TriggerPreset.taxonomy. */
  taxonomy?: string[];
  /**
   * How a configured step running this action reads, e.g. "Add {amount} to {target}", with a
   * `{fieldId}` placeholder per setting. Declared by the module; see lib/action-sentence.ts.
   */
  sentence?: string;
  config?: {
    fields: ConfigField[];
    /** DataShapeField[] naming what this action's function hands back (e.g. {next, previous}).
     * Backs the workflow builder's ${stepId.field} variable autocomplete. */
    outputs?: DataShapeField[];
  };
}

export function getDefaultConfigValues(fields: ConfigField[]): TriggerConfigValues {
  const values: TriggerConfigValues = {};
  fields.forEach((field) => {
    if (comparisonChoices(field)) {
      values[field.id] = defaultComparison(field);
    } else if (field.defaultValue !== undefined) {
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

export function formatConfigValue(
  value: ConfigValue | ComparisonValue | number | string | boolean | null,
  unit?: string
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (isComparisonValue(value)) {
    return formatComparison(value, unit);
  }

  if (typeof value === "object" && "type" in value) {
    const cv = value as ConfigValue;
    if (cv.type === "single" && cv.value !== undefined) {
      return formatAmount(cv.value, unit);
    }
    if (cv.type === "single") {
      return `${cv.value}${unit ? ` ${unit}` : ""}`;
    } else {
      return `${cv.min}-${cv.max}${unit ? ` ${unit}` : ""}`;
    }
  }

  if (typeof value === "number") {
    return formatAmount(value, unit);
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}
