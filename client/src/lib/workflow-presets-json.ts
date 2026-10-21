import type { ActionStep, ConditionConfig } from "@woofx3/api";
import { type ConfigField, isComparisonOperator } from "@woofx3/api/ui-schema";
import { comparisonChoices, defaultComparison, isComparisonValue } from "@/lib/condition-comparison";
import { isCommandsSource } from "@/lib/parse-config-fields";
import type { ActionNode } from "@/lib/workflow-tree";
import {
  type ActionPreset,
  type ConfigValue,
  getDefaultConfigValues,
  type TriggerConfigValues,
} from "./workflow-presets";

/**
 * A trigger condition field's value when it is switched to Any: the field saves no
 * condition, so the trigger matches whatever the event carries there. Distinct from an
 * empty value, which is a field the user has not finished filling in.
 */
export const ANY_CONDITION = null;

/** Condition fields that are neither Any nor filled in, and so cannot be saved as meant. */
export function incompleteConditionFields(fields: ConfigField[], values: TriggerConfigValues): ConfigField[] {
  return fields.filter((field) => {
    if (isCommandsSource(field)) {
      return false;
    }
    const value = values[field.id];
    return value === undefined || value === "" || (isComparisonValue(value) && value.value === "");
  });
}

/**
 * Whose payload a condition built from field values reads: the trigger's, or (inside a
 * wait) the event the wait is waiting for, which the engine names `event`.
 */
export type ConditionSource = "trigger" | "event";

export function fieldValuesToConditions(
  fields: ConfigField[],
  values: TriggerConfigValues,
  source: ConditionSource = "trigger"
): ConditionConfig[] {
  const out: ConditionConfig[] = [];
  for (const field of fields) {
    if (isCommandsSource(field)) {
      continue;
    }
    const raw = values[field.id];
    if (raw === null || raw === undefined || raw === "") {
      continue;
    }
    if (field.type === "range" && typeof raw === "object" && "type" in raw) {
      const cv = raw as ConfigValue;
      const path = field.eventPath ?? field.id;
      if (cv.type === "range" && cv.min !== undefined && cv.max !== undefined) {
        out.push({
          field: `\${${source}.data.${path}}`,
          operator: "between",
          value: [cv.min, cv.max],
        });
      } else if (cv.type === "single" && cv.value !== undefined) {
        out.push({
          field: `\${${source}.data.${path}}`,
          operator: field.operator ?? "eq",
          value: cv.value,
        });
      }
      continue;
    }
    const path = field.eventPath ?? field.id;
    if (isComparisonValue(raw)) {
      if (raw.value !== "") {
        out.push({ field: `\${${source}.data.${path}}`, operator: raw.operator, value: raw.value });
      }
      continue;
    }
    out.push({
      field: `\${${source}.data.${path}}`,
      operator: field.operator ?? "eq",
      value: raw as unknown,
    });
  }
  return out;
}

function conditionEventPath(condition: ConditionConfig, source: ConditionSource): string | undefined {
  const prefix = `\${${source}.data.`;
  if (!condition.field.startsWith(prefix) || !condition.field.endsWith("}")) {
    return undefined;
  }
  const path = condition.field.slice(prefix.length, -1);
  return path === "" || path.includes("}") ? undefined : path;
}

/**
 * Inverse of a single field's forward encoding in fieldValuesToConditions. A field with no
 * condition reads as ANY_CONDITION, since that is what the engine does with it. Returns
 * `undefined` only for a commands field, which is folded into the event name instead.
 */
export function decodeConditionValue(
  field: ConfigField,
  conditions: ConditionConfig[],
  source: ConditionSource = "trigger"
): TriggerConfigValues[string] | undefined {
  if (isCommandsSource(field)) {
    return undefined;
  }
  const path = field.eventPath ?? field.id;
  const condition = conditions.find((c) => conditionEventPath(c, source) === path);
  if (!condition) {
    return ANY_CONDITION;
  }
  if (field.type === "range") {
    if (condition.operator === "between" && Array.isArray(condition.value) && condition.value.length === 2) {
      return { type: "range", min: condition.value[0] as number, max: condition.value[1] as number };
    }
    return { type: "single", value: condition.value as number };
  }
  if (comparisonChoices(field)) {
    // A comparison outside the field's choices is kept rather than replaced by the
    // default, so opening and saving a condition never changes what it matches.
    const operator = isComparisonOperator(condition.operator) ? condition.operator : defaultComparison(field).operator;
    return { operator, value: condition.value as number };
  }
  return condition.value as TriggerConfigValues[string];
}

/** Inverse of fieldValuesToConditions — recovers editable field values from a trigger's stored conditions. */
export function conditionsToFieldValues(
  fields: ConfigField[],
  conditions: ConditionConfig[],
  source: ConditionSource = "trigger"
): TriggerConfigValues {
  const values = getDefaultConfigValues(fields);
  for (const field of fields) {
    const decoded = decodeConditionValue(field, conditions, source);
    if (decoded !== undefined) {
      values[field.id] = decoded;
    }
  }
  return values;
}

/**
 * The stored shape of one action a command runs: the same `ActionStep` the
 * engine executes, built from the catalog entry the user picked, mapping the
 * preset to the wire fields (action/function/ref) the way presetToActionNode does
 * for a workflow step, so the two are the same thing written once.
 */
export function presetToActionStep(preset: ActionPreset, id: string): ActionStep {
  const handlerType = preset.handlerType ?? (preset.functionCall ? "function" : undefined);
  if (!handlerType) {
    throw new Error(
      `action "${preset.name}" (${preset.id}) is missing handlerType — re-sync the catalog or reinstall the module`
    );
  }
  const step: ActionStep = {
    id,
    action: handlerType,
    parameters: getDefaultConfigValues(preset.config?.fields ?? []) as Record<string, unknown>,
  };
  if (preset.functionCall) {
    step.function = preset.functionCall;
  }
  if (preset.canonicalRef) {
    step.$ref = preset.canonicalRef;
  }
  return step;
}

/** The catalog entry an action step came from, for rendering and editing it. */
export function resolveActionStepPreset(step: ActionStep, presets: ActionPreset[]): ActionPreset | undefined {
  if (step.$ref) {
    const byRef = presets.find((preset) => preset.canonicalRef === step.$ref);
    if (byRef) {
      return byRef;
    }
  }
  if (step.function) {
    const byFunction = presets.find((preset) => preset.functionCall === step.function);
    if (byFunction) {
      return byFunction;
    }
  }
  // Last resort: match on handler type, but only when it names exactly one.
  const byHandler = presets.filter((preset) => preset.handlerType === step.action);
  return byHandler.length === 1 ? byHandler[0] : undefined;
}

/**
 * The workflow a sub-workflow step runs, for a step that names one.
 *
 * `ActionStep` does not model this shape: a command whose module declared a
 * workflow is stored as the same `{type: "workflow", workflow: {...}}` task a
 * workflow uses to call another workflow, and the engine runs a command's
 * actions as tasks, so it accepts one here.
 */
function subWorkflowId(step: ActionStep): string | undefined {
  const task = step as ActionStep & { type?: string; workflow?: { workflowId?: string } };
  if (task.type !== "workflow") {
    return undefined;
  }
  return task.workflow?.workflowId;
}

/**
 * What to call one action step: its catalog entry's name, falling back to
 * whatever the step names itself. Never empty — a step the catalog cannot
 * explain still has to render as something.
 */
export function actionStepLabel(step: ActionStep, presets: ActionPreset[]): string {
  const preset = resolveActionStepPreset(step, presets);
  if (preset) {
    return preset.name;
  }
  const workflowId = subWorkflowId(step);
  if (workflowId) {
    return `Run workflow ${workflowId}`;
  }
  return step.function ?? step.action ?? "Unrecognized action";
}

/**
 * Builds a fresh ActionNode for a newly-inserted step, from a catalog
 * ActionPreset the user picked in the action picker. Mirrors buildActionTask's
 * preset -> wire-field mapping (action/function/ref), pre-filled with the
 * preset's default config values so the step is immediately meaningful.
 */
export function presetToActionNode(preset: ActionPreset, id: string): ActionNode {
  const handlerType = preset.handlerType ?? (preset.functionCall ? "function" : undefined);
  if (!handlerType) {
    throw new Error(
      `action "${preset.name}" (${preset.id}) is missing handlerType — re-sync the catalog or reinstall the module`
    );
  }
  const node: ActionNode = {
    type: "action",
    id,
    action: handlerType,
    parameters: getDefaultConfigValues(preset.config?.fields ?? []),
  };
  if (preset.functionCall) {
    node.function = preset.functionCall;
  }
  if (preset.canonicalRef) {
    node.ref = preset.canonicalRef;
  }
  return node;
}
