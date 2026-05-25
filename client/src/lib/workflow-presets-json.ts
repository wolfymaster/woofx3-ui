import type { ConditionConfig, WorkflowDefinition } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { TaskDefinition, TriggerConfig as WorkflowTriggerConfig } from "@woofx3/api/workflow-definition";
import { isCommandsSource } from "@/lib/parse-config-fields";
import type { ActionPreset, ConfigValue, TriggerConfigValues, TriggerPreset, TriggerVariant } from "./workflow-presets";

type TriggerWithEvent = TriggerPreset & { event?: string };

function triggerBaseEvent(t: TriggerWithEvent): string {
  if (!t.event) {
    throw new Error(`Trigger preset "${t.id}" is missing an "event" field`);
  }
  return t.event;
}

function commandsSourceFields(fields: ConfigField[]): ConfigField[] {
  return fields.filter((f) => isCommandsSource(f));
}

function assembleEventType(trigger: TriggerWithEvent, config: TriggerConfigValues): string {
  const base = triggerBaseEvent(trigger);
  const commandFields = commandsSourceFields(trigger.config?.fields ?? []);
  if (commandFields.length === 0) {
    return base;
  }
  const parts: string[] = [base];
  for (const field of commandFields) {
    const value = config[field.id];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`trigger "${trigger.id}": config field "${field.id}" missing or not a string`);
    }
    parts.push(value);
  }
  return parts.join(".");
}

export function fieldValuesToConditions(fields: ConfigField[], values: TriggerConfigValues): ConditionConfig[] {
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
          field: `\${trigger.data.${path}}`,
          operator: "between",
          value: [cv.min, cv.max],
        });
      } else if (cv.type === "single" && cv.value !== undefined) {
        out.push({
          field: `\${trigger.data.${path}}`,
          operator: field.operator ?? "eq",
          value: cv.value,
        });
      }
      continue;
    }
    const path = field.eventPath ?? field.id;
    out.push({
      field: `\${trigger.data.${path}}`,
      operator: field.operator ?? "eq",
      value: raw as unknown,
    });
  }
  return out;
}

function buildTriggerBlock(
  trigger: TriggerWithEvent,
  values: TriggerConfigValues,
  triggerRef?: string
): WorkflowTriggerConfig {
  const block: WorkflowTriggerConfig & { $ref?: string } = {
    type: "event",
    event: assembleEventType(trigger, values),
    conditions: fieldValuesToConditions(trigger.config?.fields ?? [], values),
  };
  if (triggerRef) {
    block.$ref = triggerRef;
  }
  return block;
}

/** Engine task shape includes graph metadata and function dispatch fields. */
type WorkflowActionTask = TaskDefinition & { $ref?: string; function?: string };

function buildActionTask(
  action: ActionPreset,
  parameters: TriggerConfigValues,
  taskId = "action-1"
): WorkflowActionTask {
  const handlerType = action.handlerType ?? (action.functionCall ? "function" : undefined);
  if (!handlerType) {
    throw new Error(
      `action "${action.name}" (${action.id}) is missing handlerType — re-sync the catalog or reinstall the module`
    );
  }
  const task: WorkflowActionTask = {
    id: taskId,
    type: "action",
    action: handlerType,
    parameters: { ...parameters },
  };
  if (action.functionCall) {
    task.function = action.functionCall;
  }
  if (action.canonicalRef) {
    task.$ref = action.canonicalRef;
  }
  return task;
}

function resolveTriggerRef(trigger: TriggerWithEvent, triggerRef?: string): string | undefined {
  return triggerRef ?? trigger.canonicalRef;
}

export function buildDefinitionFromPresets(
  trigger: TriggerWithEvent,
  action: ActionPreset,
  triggerConfig: TriggerConfigValues,
  actionConfig: TriggerConfigValues,
  triggerRef?: string
): Omit<WorkflowDefinition, "id"> {
  return {
    name: `${trigger.name} → ${action.name}`,
    description: `When ${trigger.description.toLowerCase()}, ${action.description.toLowerCase()}.`,
    trigger: buildTriggerBlock(trigger, triggerConfig, resolveTriggerRef(trigger, triggerRef)),
    tasks: [buildActionTask(action, actionConfig)],
  };
}

export function buildDefinitionForVariant(
  trigger: TriggerWithEvent,
  variant: TriggerVariant,
  triggerRef?: string
): Omit<WorkflowDefinition, "id"> {
  if (!variant.action) {
    throw new Error("variant action is required");
  }
  const workflowName = variant.displayName.trim()
    ? `${variant.displayName} → ${variant.action.name}`
    : `${trigger.name} → ${variant.action.name}`;
  return {
    name: workflowName,
    description: `When ${trigger.description.toLowerCase()}, ${variant.action.description.toLowerCase()}.`,
    trigger: buildTriggerBlock(trigger, variant.values, resolveTriggerRef(trigger, triggerRef)),
    tasks: [buildActionTask(variant.action, variant.actionConfig)],
  };
}

export function buildDefinitionsForVariants(
  trigger: TriggerWithEvent,
  variants: TriggerVariant[],
  triggerRef?: string
): Omit<WorkflowDefinition, "id">[] {
  return variants.filter((v) => v.action).map((v) => buildDefinitionForVariant(trigger, v, triggerRef));
}

/** @deprecated Use buildDefinitionsForVariants — one workflow per variant with trigger.conditions */
export function buildTieredDefinition(
  trigger: TriggerWithEvent,
  variants: TriggerVariant[],
  triggerRef?: string
): Omit<WorkflowDefinition, "id">[] {
  return buildDefinitionsForVariants(trigger, variants, triggerRef);
}
