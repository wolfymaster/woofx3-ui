import type { Doc } from "@convex/_generated/dataModel";
import type { ConfigField } from "@woofx3/api/ui-schema";
import type { EventEditorState } from "@/lib/event-drafts";
import { isCommandsSource } from "@/lib/parse-config-fields";
import type { ResourceAction } from "@/lib/resource-actions";
import { nextTaskId, type ProjectedAction, projectWorkflow } from "@/lib/trigger-projection";
import { type ActionPreset, getDefaultConfigValues, type TriggerPreset } from "@/lib/workflow-presets";
import { conditionsToFieldValues } from "@/lib/workflow-presets-json";

/**
 * One condition field held to one value: a resource page edits only the triggers for
 * its own instance ("when Break timer ends"), while the workflow — and so every other
 * instance's triggers — is still the one the Alerts screen would edit. A new trigger
 * starts pinned to the value, and the pinned field reads as text rather than a picker,
 * so it cannot be moved to another instance from here.
 */
export interface EventScope {
  fieldId: string;
  value: string;
  /** What the sentence shows for the value, e.g. the instance's display name. */
  label: string;
}

/**
 * One action parameter held to one value — the mirror of EventScope, for the triggers
 * that *change* a resource rather than react to it. Only the triggers running one of
 * `actions` against `value` are shown, a new step is aimed at it, and the parameter that
 * aims it is hidden: on the instance's own page its picker could only offer it again.
 */
export interface ActionScope {
  /** The kind's actions and the `resource_ref` parameter each aims; see resourceActions(). */
  actions: ResourceAction[];
  /** The instance's canonical id. */
  value: string;
}

export interface EventWorkflowTarget {
  /** The workflow this screen edits for the event, if one exists yet. */
  primary: Doc<"workflows"> | undefined;
  /** The event's other workflows, which this screen leaves alone. */
  others: Doc<"workflows">[];
  /** A workflow on this event this screen can't project, if there is one. */
  unprojectable: Doc<"workflows"> | undefined;
}

/**
 * Which of an event's workflows a triggers screen edits: the first it can project.
 * Others on the same event are left alone and pointed at the builder rather than
 * silently merged.
 *
 * Each workflow is projected once here, because projecting walks the whole definition.
 */
export function eventWorkflowTarget(workflows: Doc<"workflows">[] | undefined, event: string): EventWorkflowTarget {
  const matching: { row: Doc<"workflows">; projectable: boolean }[] = [];
  for (const row of workflows ?? []) {
    const projected = projectWorkflow(row);
    const rowsEvent = projected.ok ? projected.projection.event : definitionEvent(row);
    if (rowsEvent === event) {
      matching.push({ row, projectable: projected.ok });
    }
  }
  const primary = matching.find((entry) => entry.projectable);
  return {
    primary: primary?.row,
    others: matching.filter((entry) => entry !== primary).map((entry) => entry.row),
    unprojectable: matching.find((entry) => !entry.projectable)?.row,
  };
}

/**
 * The fields a trigger's conditions are set from. A commands field is folded into the
 * event name rather than held as a condition, so it has no place in the sentence.
 */
export function conditionFieldsOf(triggerPreset: TriggerPreset | undefined): ConfigField[] {
  return (triggerPreset?.config?.fields ?? []).filter((field) => !isCommandsSource(field));
}

/** The editor state for an event, read from the workflow that serves it, or empty. */
export function eventEditorStateFor(
  workflows: Doc<"workflows">[],
  triggerPreset: TriggerPreset,
  conditionFields: ConfigField[]
): EventEditorState {
  const { primary } = eventWorkflowTarget(workflows, triggerPreset.event ?? "");
  const projected = primary ? projectWorkflow(primary) : undefined;
  if (projected?.ok === true) {
    const { projection } = projected;
    return {
      engineWorkflowId: projection.engineWorkflowId,
      name: projection.name,
      triggers: projection.triggers,
      shared: projection.shared,
      conditionValues: Object.fromEntries(
        projection.triggers.map((trigger) => [trigger.id, conditionsToFieldValues(conditionFields, trigger.conditions)])
      ),
    };
  }
  return { name: `${triggerPreset.name} triggers`, triggers: [], shared: [], conditionValues: {} };
}

/** Every task id in use, so a new step never collides with one already in the workflow. */
export function usedTaskIds(state: EventEditorState): string[] {
  return [
    ...state.triggers.map((trigger) => trigger.id),
    ...state.triggers.flatMap((trigger) => trigger.actions.map((action) => action.id)),
    ...state.shared.map((shared) => shared.id),
  ];
}

/**
 * A step running `preset`.
 *
 * Under an action scope the step is aimed at the scoped instance and given *no* other
 * parameters: an action's optional number field would otherwise be seeded with its
 * minimum (see getDefaultConfigValues), which for Increment counter means a hard `1`
 * silently replacing the counter's own step.
 */
export function newProjectedAction(id: string, preset: ActionPreset, actionScope?: ActionScope): ProjectedAction {
  const aimed = actionScope?.actions.find((candidate) => candidate.preset.id === preset.id);
  return {
    id,
    handlerType: preset.handlerType ?? "function",
    functionCall: preset.functionCall,
    parameters: aimed
      ? { [aimed.fieldId]: actionScope?.value ?? "" }
      : getDefaultConfigValues(preset.config?.fields ?? []),
    concurrentWithPrevious: false,
  };
}

export interface NewTriggerOptions {
  scope?: EventScope;
  actionScope?: ActionScope;
  /** A step the trigger starts with, for a surface that chooses one as it adds the trigger. */
  seed?: ActionPreset;
}

/** The state with one more trigger, pinned to whatever the surface scopes it to. */
export function withNewTrigger(
  state: EventEditorState,
  conditionFields: ConfigField[],
  options: NewTriggerOptions = {}
): { state: EventEditorState; triggerId: string } {
  const used = usedTaskIds(state);
  const triggerId = nextTaskId("rule", used);
  const values = {
    ...getDefaultConfigValues(conditionFields),
    ...(options.scope ? { [options.scope.fieldId]: options.scope.value } : {}),
  };
  const actions = options.seed
    ? [newProjectedAction(nextTaskId("act", [...used, triggerId]), options.seed, options.actionScope)]
    : [];
  return {
    state: {
      ...state,
      triggers: [...state.triggers, { id: triggerId, enabled: true, conditions: [], actions }],
      conditionValues: { ...state.conditionValues, [triggerId]: values },
    },
    triggerId,
  };
}

function definitionEvent(row: Doc<"workflows">): string | undefined {
  const definition = row.definition as { trigger?: { event?: string } } | undefined;
  return definition?.trigger?.event;
}
