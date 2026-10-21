import type { ConfigField } from "@woofx3/api/ui-schema";
import type { WorkflowRecord } from "@/engine/types";
import type { EventEditorState } from "@/lib/event-drafts";
import { isCommandsSource } from "@/lib/parse-config-fields";
import { nextTaskId, type ProjectedAction, projectWorkflow, type WorkflowProjection } from "@/lib/trigger-projection";
import { type ActionPreset, getDefaultConfigValues, type TriggerPreset } from "@/lib/workflow-presets";
import { conditionsToFieldValues } from "@/lib/workflow-presets-json";

export interface EventWorkflowTarget {
  /** The workflow this screen edits for the event, if one exists yet. */
  primary: WorkflowRecord | undefined;
  /** The event's other workflows, which this screen leaves alone. */
  others: WorkflowRecord[];
  /** A workflow on this event this screen can't project, if there is one. */
  unprojectable: WorkflowRecord | undefined;
}

/**
 * Which of an event's workflows a triggers screen edits: the first it can project.
 * Others on the same event are left alone and pointed at the builder rather than
 * silently merged.
 *
 * Each workflow is projected once here, because projecting walks the whole definition.
 */
export function eventWorkflowTarget(workflows: WorkflowRecord[] | undefined, event: string): EventWorkflowTarget {
  const matching: { row: WorkflowRecord; projectable: boolean }[] = [];
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
  workflows: WorkflowRecord[],
  triggerPreset: TriggerPreset,
  conditionFields: ConfigField[]
): EventEditorState {
  const { primary } = eventWorkflowTarget(workflows, triggerPreset.event ?? "");
  const projected = primary ? projectWorkflow(primary) : undefined;
  if (projected?.ok === true) {
    return editorStateOfProjection(projected.projection, conditionFields);
  }
  return { name: `${triggerPreset.name} triggers`, triggers: [], shared: [], conditionValues: {} };
}

/** The editor state a projected workflow reads as. */
export function editorStateOfProjection(
  projection: WorkflowProjection,
  conditionFields: ConfigField[]
): EventEditorState {
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

/** Every task id in use, so a new step never collides with one already in the workflow. */
export function usedTaskIds(state: EventEditorState): string[] {
  return [
    ...state.triggers.map((trigger) => trigger.id),
    ...state.triggers.flatMap((trigger) => trigger.actions.map((action) => action.id)),
    ...state.shared.map((shared) => shared.id),
  ];
}

/** A step running `preset`, seeded the way the workflow builder seeds one. */
export function newProjectedAction(id: string, preset: ActionPreset): ProjectedAction {
  return {
    id,
    handlerType: preset.handlerType ?? "function",
    functionCall: preset.functionCall,
    parameters: getDefaultConfigValues(preset.config?.fields ?? []),
    concurrentWithPrevious: false,
  };
}

/** The state with one more trigger, its condition fields at their defaults. */
export function withNewTrigger(
  state: EventEditorState,
  conditionFields: ConfigField[]
): { state: EventEditorState; triggerId: string } {
  const triggerId = nextTaskId("rule", usedTaskIds(state));
  return {
    state: {
      ...state,
      triggers: [...state.triggers, { id: triggerId, enabled: true, conditions: [], actions: [] }],
      conditionValues: { ...state.conditionValues, [triggerId]: getDefaultConfigValues(conditionFields) },
    },
    triggerId,
  };
}

function definitionEvent(row: WorkflowRecord): string | undefined {
  const definition = row.definition as { trigger?: { event?: string } } | undefined;
  return definition?.trigger?.event;
}
