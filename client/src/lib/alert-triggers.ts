import type { ConditionConfig, WorkflowDefinition } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { Workflow } from "@/engine/types";
import { unescapeDollarKeys } from "@/lib/dollar-keys";
import type { ResourceAction } from "@/lib/resource-actions";
import {
  type ActionPreset,
  getDefaultConfigValues,
  type TriggerConfigValues,
  type TriggerPreset,
} from "@/lib/workflow-presets";
import { conditionsToFieldValues, fieldValuesToConditions, presetToActionNode } from "@/lib/workflow-presets-json";
import { definitionToTree, type StepNode, treeToDefinition, type WorkflowTree } from "@/lib/workflow-tree";

/**
 * An event's triggers, as the Alerts screen and the resource pages list them.
 *
 * Each trigger is a workflow of its own: the event on its trigger, the trigger's
 * conditions as the workflow trigger's conditions, and its steps as the workflow's
 * steps. Every workflow on the event is one, however it was made, so a trigger
 * written in the workflow builder shows here too.
 *
 * Every trigger whose conditions hold runs; nothing stops at the first match. The
 * ones carrying `trigger.order` run one after another, lowest first, each starting
 * once the one before it finishes or pauses at a wait (docs/workflow/execution.md in
 * the engine), which is what makes the list's order the order their alerts queue in.
 * A workflow without an order runs alongside them as soon as the event arrives.
 */
export interface EventTrigger {
  row: Workflow;
  definition: WorkflowDefinition;
  /** `trigger.order`, or undefined for a workflow that runs alongside the ordered ones. */
  order: number | undefined;
  conditions: ConditionConfig[];
}

type OrderedTrigger = WorkflowDefinition["trigger"] & { order?: unknown };

/** The event's triggers in the order they run: the ordered ones as the engine orders them, then the rest. */
export function eventTriggers(workflows: readonly Workflow[], event: string): EventTrigger[] {
  const found: EventTrigger[] = [];
  for (const row of workflows) {
    const definition = unescapeDollarKeys(row.definition) as WorkflowDefinition | undefined;
    const trigger = definition?.trigger as OrderedTrigger | undefined;
    if (!definition || !trigger || trigger.type !== "event" || trigger.event !== event) {
      continue;
    }
    found.push({
      row,
      definition,
      order: typeof trigger.order === "number" ? trigger.order : undefined,
      conditions: trigger.conditions ?? [],
    });
  }
  // Must match executeInOrder in the engine's workflow/internal/engine/engine.go.
  return found.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order || compareIds(a.row.engineWorkflowId, b.row.engineWorkflowId);
    }
    if (a.order !== undefined || b.order !== undefined) {
      return a.order !== undefined ? -1 : 1;
    }
    return a.row.createdAt - b.row.createdAt || compareIds(a.row.engineWorkflowId, b.row.engineWorkflowId);
  });
}

/** Byte order, as Go's strings.Compare orders ids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The order a trigger added to the end of the list takes. */
export function nextTriggerOrder(triggers: readonly EventTrigger[]): number {
  const orders = triggers.flatMap((trigger) => (trigger.order === undefined ? [] : [trigger.order]));
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

/** The trigger's condition values, field by field, as its sentence shows them. */
export function triggerFieldValues(conditions: ConditionConfig[], fields: ConfigField[]): TriggerConfigValues {
  return conditionsToFieldValues(fields, conditions);
}

/**
 * The trigger's conditions with the fields' values written in. A condition no field
 * owns — one added in the workflow builder — is kept as it is, so changing the
 * sentence never drops a check the sentence doesn't show.
 */
export function withFieldConditions(
  conditions: ConditionConfig[],
  fields: ConfigField[],
  values: TriggerConfigValues
): ConditionConfig[] {
  const owned = new Set(fields.map((field) => `\${trigger.data.${field.eventPath ?? field.id}}`));
  return [...conditions.filter((condition) => !owned.has(condition.field)), ...fieldValuesToConditions(fields, values)];
}

/** One condition field held to one value, as a resource page pins its own triggers to its instance. */
export interface TriggerPin {
  fieldId: string;
  value: string;
}

/** Whether the trigger's conditions hold `pin`'s field to its value. */
export function isPinnedTo(trigger: EventTrigger, fields: ConfigField[], pin: TriggerPin): boolean {
  return triggerFieldValues(trigger.conditions, fields)[pin.fieldId] === pin.value;
}

/** Whether any step, inside conditions too, runs one of `actions` aimed at `canonicalId`. */
export function stepsAimAt(
  steps: readonly StepNode[],
  actions: readonly ResourceAction[],
  canonicalId: string
): boolean {
  return steps.some((step) => {
    if (step.type === "condition") {
      return stepsAimAt(step.thenBranch, actions, canonicalId) || stepsAimAt(step.elseBranch, actions, canonicalId);
    }
    if (step.type !== "action") {
      return false;
    }
    return actions.some(({ preset, fieldId }) => {
      const runs = step.function ? preset.functionCall === step.function : preset.handlerType === step.action;
      return runs && step.parameters[fieldId] === canonicalId;
    });
  });
}

/** Whether a stored workflow's steps aim at `canonicalId`; one the editor can't read counts as not. */
export function triggerAimsAt(trigger: EventTrigger, actions: readonly ResourceAction[], canonicalId: string): boolean {
  const read = definitionToTree(trigger.definition);
  return read.editable && stepsAimAt(read.tree.steps, actions, canonicalId);
}

export interface NewTriggerOptions {
  triggerPreset: TriggerPreset;
  conditionFields: ConfigField[];
  order: number;
  pin?: TriggerPin;
  /** A step the trigger starts with, aimed by `aim` when given. */
  seed?: ActionPreset;
  aim?: TriggerPin;
}

/** Id of the step a new trigger starts with. */
export const SEED_STEP_ID = "step_1";

/**
 * The tree of a trigger not yet saved: the event, its fields' default values (with
 * `pin` held), the next order and, when given, its first step. Unfinished fields save
 * no condition, so they read as missing in the sentence until they are chosen.
 */
export function newTriggerTree(options: NewTriggerOptions): WorkflowTree {
  const { triggerPreset, conditionFields, order, pin, seed, aim } = options;
  const values = {
    ...getDefaultConfigValues(conditionFields),
    ...(pin ? { [pin.fieldId]: pin.value } : {}),
  };
  const tasks: WorkflowDefinition["tasks"] = [];
  if (seed) {
    const node = presetToActionNode(seed, SEED_STEP_ID);
    if (aim) {
      // Aimed and nothing else: an optional number field seeded with its minimum
      // would replace the instance's own setting (Increment counter's "Counts by").
      node.parameters = { [aim.fieldId]: aim.value };
    }
    tasks.push(...treeToDefinition({ trigger: emptyTrigger(), steps: [node] }).tasks);
  }
  const definition = {
    id: "",
    name: triggerPreset.name,
    trigger: {
      type: "event",
      event: triggerPreset.event ?? "",
      ...(triggerPreset.canonicalRef ? { $ref: triggerPreset.canonicalRef } : {}),
      conditions: fieldValuesToConditions(conditionFields, values),
      order,
    },
    tasks,
  } as unknown as WorkflowDefinition;
  const read = definitionToTree(definition);
  if (!read.editable) {
    throw new Error(`a new ${triggerPreset.name} trigger does not read as a tree: ${read.message}`);
  }
  return read.tree;
}

function emptyTrigger(): WorkflowTree["trigger"] {
  return { type: "trigger", id: "trigger", event: "", conditions: [] };
}
