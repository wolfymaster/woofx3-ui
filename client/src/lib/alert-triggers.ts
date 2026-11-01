import { unescapeDollarKeys } from "@shared/dollar-keys";
import type { ConditionConfig, WorkflowDefinition } from "@woofx3/api";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { Workflow } from "@/engine/types";
import { isCommandsSource } from "@/lib/parse-config-fields";
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
 * The engine gives each of the streamer's workflows an order, ahead of any module's on
 * the same trigger, so what a card lists is what happens.
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

/**
 * Workflows that start on the same event under the same conditions, shown as one trigger.
 * Modules' stay separate workflows so one module's failure or wait can't stop another's
 * steps; the streamer's are merged by the engine. `members` are in the order they run.
 */
export interface TriggerGroup {
  key: string;
  conditions: ConditionConfig[];
  members: EventTrigger[];
}

/** One group per distinct set of conditions, in the order its first member runs. */
export function groupEventTriggers(triggers: readonly EventTrigger[]): TriggerGroup[] {
  const groups = new Map<string, TriggerGroup>();
  for (const trigger of triggers) {
    // A workflow keeping several triggers in its tasks has conditions its trigger doesn't
    // show, so it matches nothing else.
    const key = definitionToTree(trigger.definition).editable
      ? conditionsKey(trigger.conditions)
      : `workflow:${trigger.row.engineWorkflowId}`;
    const group = groups.get(key);
    if (group) {
      group.members.push(trigger);
    } else {
      groups.set(key, { key, conditions: trigger.conditions, members: [trigger] });
    }
  }
  return Array.from(groups.values());
}

/** The same conditions give the same key whatever order they were written in. */
function conditionsKey(conditions: readonly ConditionConfig[]): string {
  const written = conditions.map((condition) =>
    JSON.stringify([condition.field, condition.operator, condition.value ?? null])
  );
  return `conditions:${Array.from(new Set(written)).sort().join("|")}`;
}

/** What a module calls its steps on this trigger. Barkloader names its workflows `{module}/{manifest name}`. */
export function moduleStepsName(trigger: EventTrigger): string {
  const name = trigger.definition.name ?? "";
  return name.slice(name.indexOf("/") + 1) || name;
}

/** A trigger's workflows by the part each plays on its card. */
export interface TriggerParts {
  /** The streamer's switched-on workflow whose steps the card edits. */
  steps: EventTrigger | undefined;
  /** The streamer's paused workflows, which merge into `steps` when resumed. */
  paused: EventTrigger[];
  /** The streamer's switched-on workflows the engine couldn't merge into `steps`. */
  apart: EventTrigger[];
  modules: EventTrigger[];
}

export function triggerParts(group: TriggerGroup): TriggerParts {
  const own = group.members.filter((member) => !member.row.projectionKey);
  const running = own.filter((member) => member.row.isEnabled);
  return {
    steps: running[0],
    paused: own.filter((member) => !member.row.isEnabled),
    apart: running.slice(1),
    modules: group.members.filter((member) => member.row.projectionKey),
  };
}

/** A closed card's line: "Play Confetti alert, Say thanks, and 2 modules", or the modules' names alone. */
export function triggerSummary(stepTitles: readonly string[], moduleNames: readonly string[]): string {
  if (stepTitles.length === 0) {
    return moduleNames.join(", ");
  }
  const moduleCount = moduleNames.length;
  const items =
    moduleCount === 0 ? [...stepTitles] : [...stepTitles, moduleCount === 1 ? "1 module" : `${moduleCount} modules`];
  if (items.length < 2 || moduleCount === 0) {
    return items.join(", ");
  }
  return items.length === 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

const OPERATOR_WORDS: Partial<Record<ConditionConfig["operator"], string>> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  regex: "matches",
};

/** The conditions no sentence field shows, read as words, so no check on a trigger is invisible. */
export function unownedConditionPhrases(conditions: readonly ConditionConfig[], fields: ConfigField[]): string[] {
  const owned = new Set(fields.map((field) => `\${trigger.data.${field.eventPath ?? field.id}}`));
  return conditions
    .filter((condition) => !owned.has(condition.field))
    .map((condition) => {
      const subject = condition.field.replace(/^\$\{trigger\.data\.(.*)\}$/, "$1");
      const operator = OPERATOR_WORDS[condition.operator] ?? condition.operator.replaceAll("_", " ");
      return condition.value === undefined
        ? `${subject} ${operator}`
        : `${subject} ${operator} ${JSON.stringify(condition.value)}`;
    });
}

/**
 * Whether stored steps gained ones an open editor doesn't hold, which is how another
 * workflow's steps arriving by a merge looks. The editor saves its whole list, so it has to
 * pick those up or its next save removes them. A step the editor just removed is not a
 * gain: it was already in the previous copy.
 */
export function storedStepsGained(
  previous: readonly { id: string }[],
  stored: readonly { id: string }[],
  held: readonly { id: string }[]
): boolean {
  const known = new Set([...previous, ...held].map((task) => task.id));
  return stored.some((task) => !known.has(task.id));
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

/**
 * The fields a trigger's conditions are set from. A commands field is folded into the
 * event name rather than held as a condition, so it has no place in the sentence.
 */
export function conditionFieldsOf(triggerPreset: TriggerPreset | undefined): ConfigField[] {
  return (triggerPreset?.config?.fields ?? []).filter((field) => !isCommandsSource(field));
}

/**
 * How many triggers a workflow holds as condition tasks: one per `condition` task, plus
 * one for the actions no condition branches to or guards, which run on every event.
 */
export function storedTriggerCount(definition: WorkflowDefinition): number {
  const tasks = definition.tasks ?? [];
  const conditions = tasks.filter((task) => task.type === "condition");
  const branched = new Set(conditions.flatMap((task) => [...(task.onTrue ?? []), ...(task.onFalse ?? [])]));
  const unguarded = tasks.some(
    (task) =>
      task.type === "action" && !branched.has(task.id) && (task.conditions ?? []).length === 0 && !task.condition
  );
  return conditions.length + (unguarded ? 1 : 0);
}

export interface NewTriggerOptions {
  triggerPreset: TriggerPreset;
  conditionFields: ConfigField[];
  /** Its place among the event's other workflows; a workflow made on its own has none. */
  order?: number;
  pin?: TriggerPin;
  /** Conditions it starts with instead of the fields' defaults, when joining a trigger that has them. */
  conditions?: ConditionConfig[];
  /** A step the trigger starts with, aimed by `aim` when given. */
  seed?: ActionPreset;
  aim?: TriggerPin;
}

/** Id of the step a new trigger starts with. */
export const SEED_STEP_ID = "step_1";

/**
 * The tree of a trigger not yet saved: the event, its fields' default values (with
 * `pin` held), its order when given and, when given, its first step. Unfinished fields save
 * no condition, so they read as missing in the sentence until they are chosen.
 */
export function newTriggerTree(options: NewTriggerOptions): WorkflowTree {
  const { triggerPreset, conditionFields, order, pin, conditions, seed, aim } = options;
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
      conditions: conditions ?? fieldValuesToConditions(conditionFields, values),
      ...(order === undefined ? {} : { order }),
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
