import type { ConfigField } from "@woofx3/api/ui-schema";
import type { WorkflowRecord } from "@/engine/types";
import type { EventEditorState } from "@/lib/event-drafts";
import { isCommandsSource } from "@/lib/parse-config-fields";
import { projectWorkflow } from "@/lib/trigger-projection";
import type { TriggerPreset } from "@/lib/workflow-presets";
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

function definitionEvent(row: WorkflowRecord): string | undefined {
  const definition = row.definition as { trigger?: { event?: string } } | undefined;
  return definition?.trigger?.event;
}
