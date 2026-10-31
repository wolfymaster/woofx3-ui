import { type FormField, parseFormFields } from "@shared/user-pages";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { newTriggerTree, type TriggerPin } from "@/lib/alert-triggers";
import type { ActionPreset, TriggerPreset } from "@/lib/workflow-presets";
import type { TriggerNode, WorkflowTree } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

/** The event a form's submissions fire; declared by the bundled woofx3 module. */
export const FORM_SUBMITTED_EVENT = "userpage.form.submitted";

/** The condition path the trigger's form filter writes. Must match its `eventPath` in the module's manifest. */
const FORM_CONDITION_FIELD = "${trigger.data.formId}";

/** The module's `queue.add` action. */
export const QUEUE_ADD_ACTION_REF = "woofx3:action:queue.add";

/** How a workflow triggered by a form reads the answer to the question `fieldId`. */
export function formAnswerReference(fieldId: string): string {
  return `\${trigger.data.answers.${fieldId}}`;
}

/** The form instance a trigger is narrowed to, by canonical id; null for one acting on any form. */
function pinnedFormId(trigger: TriggerNode): string | null {
  const condition = trigger.conditions.find((candidate) => candidate.field === FORM_CONDITION_FIELD);
  return typeof condition?.value === "string" ? condition.value : null;
}

/**
 * Each question of the form a submitted trigger is narrowed to, as a variable
 * named by the question. A trigger's catalog entry can only say `answers` exists,
 * since the questions belong to the instance. An id of only digits reads as an
 * array index and can't be reached this way, which the question id rules refuse.
 */
export function formAnswerVariables(
  trigger: TriggerNode,
  forms: readonly { canonicalId: string; settings?: unknown }[]
): VariableOption[] {
  if (trigger.event !== FORM_SUBMITTED_EVENT) {
    return [];
  }
  const formId = pinnedFormId(trigger);
  const form = forms.find((row) => row.canonicalId === formId);
  if (!form) {
    return [];
  }
  const settings = form.settings as { fields?: unknown } | null | undefined;
  return parseFormFields(settings?.fields).map((field) => ({
    value: formAnswerReference(field.id),
    label: field.label || field.id,
    group: "Trigger",
    type: field.type === "checkbox" ? "boolean" : "string",
    description: "What the viewer answered to this question.",
  }));
}

/** What can go in line for a form, as a queue entry is text: each question that isn't a checkbox, and who sent it. */
export function formQueueEntryChoices(fields: readonly FormField[]): { value: string; label: string }[] {
  return [
    ...fields
      .filter((field) => field.type !== "checkbox")
      .map((field) => ({ value: formAnswerReference(field.id), label: field.label || field.id })),
    { value: "${trigger.data.viewer.displayName}", label: "The viewer's name" },
  ];
}

export interface FormQueueWorkflowOptions {
  triggerPreset: TriggerPreset;
  conditionFields: ConfigField[];
  order: number;
  /** The trigger's form field, held to the form. */
  form: TriggerPin;
  queueAdd: ActionPreset;
  /** The action's queue field, aimed at the queue. */
  queue: TriggerPin;
  entry: string;
}

/** An ordinary workflow, editable like any other: when this form is submitted, add `entry` to the queue. */
export function formQueueWorkflowTree(options: FormQueueWorkflowOptions): WorkflowTree {
  const { triggerPreset, conditionFields, order, form, queueAdd, queue, entry } = options;
  const tree = newTriggerTree({ triggerPreset, conditionFields, order, pin: form, seed: queueAdd, aim: queue });
  return {
    ...tree,
    steps: tree.steps.map((step) =>
      step.type === "action" ? { ...step, parameters: { ...step.parameters, entry } } : step
    ),
  };
}
