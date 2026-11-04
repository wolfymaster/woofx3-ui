import { columnIdFor } from "@shared/databases/columns";
import { type FormField, parseFormFields } from "@shared/user-pages";
import type { WorkflowDefinition } from "@woofx3/api";
import type { DatabaseColumn } from "@woofx3/api/databases";
import type { ConfigField } from "@woofx3/api/ui-schema";
import { type EventTrigger, newTriggerTree, type TriggerPin } from "@/lib/alert-triggers";
import type { ActionPreset, TriggerPreset } from "@/lib/workflow-presets";
import type { TriggerNode, WorkflowTree } from "@/lib/workflow-tree";
import type { VariableOption } from "@/lib/workflow-variables";

/** The event a form's submissions fire; declared by the bundled woofx3 module. */
export const FORM_SUBMITTED_EVENT = "userpage.form.submitted";

/** The condition path the trigger's form filter writes. Must match its `eventPath` in the module's manifest. */
const FORM_CONDITION_FIELD = "${trigger.data.formId}";

/** The module's `database.insert` action. */
export const DATABASE_INSERT_ACTION_REF = "woofx3:action:database.insert";

/** How a workflow triggered by a form reads who sent it. */
const VIEWER_NAME_REFERENCE = "${trigger.data.viewer.displayName}";
/** The id the viewer column takes, unless a question already has it. */
const VIEWER_COLUMN_ID = "viewer";
/** How a workflow triggered by a form reads the submission's id, unique per submission. */
const SUBMISSION_ID_REFERENCE = "${trigger.data.submissionId}";

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

/** The review queue that approves into `queueId`, or how to create one when there is none yet. */
export function reviewQueueFor(
  queues: readonly { canonicalId: string; settings?: unknown }[],
  queueId: string,
  queueLabel: string
): { kind: "existing"; canonicalId: string } | { kind: "create"; resourceInstanceId: string; displayName: string } {
  const existing = queues.find((row) => {
    const settings = row.settings as Record<string, unknown> | null | undefined;
    return settings?.approveInto === queueId;
  });
  if (existing) {
    return { kind: "existing", canonicalId: existing.canonicalId };
  }
  const instance = queueId.split(":").pop() ?? "";
  return { kind: "create", resourceInstanceId: `${instance}_review`, displayName: `${queueLabel} review` };
}

const COLUMN_VALUE = /^[A-Za-z0-9_-]{1,64}$/;
/** Must match the engine's select option limit (DATABASE_LIMITS.selectOptions). */
const MAX_SELECT_OPTIONS = 50;

/**
 * The column a question's answers fill, private like every answer. A choice
 * keeps its options when every value is one a column option may hold, and
 * is plain text otherwise.
 */
function questionColumn(field: FormField): DatabaseColumn {
  const base = { id: field.id, label: field.label.trim() || field.id, public: false };
  switch (field.type) {
    case "checkbox":
      return { ...base, type: "boolean" };
    case "select":
      return field.options.length > 0 &&
        field.options.length <= MAX_SELECT_OPTIONS &&
        field.options.every((option) => COLUMN_VALUE.test(option.value))
        ? { ...base, type: "select", options: field.options.map(({ value, label }) => ({ value, label })) }
        : { ...base, type: "text" };
    case "text":
    case "textarea":
      return { ...base, type: "text" };
  }
}

/** The id of the column that holds who sent each answer. */
export function viewerColumnId(fields: readonly FormField[]): string {
  return columnIdFor(VIEWER_COLUMN_ID, new Set(fields.map((field) => field.id)));
}

/**
 * The columns a database keeping a form's answers needs: `existing`, then a
 * column for each question it lacks and the viewer's name, all private. A
 * column already there is left as it is, so running this again adds only new
 * questions.
 */
export function formDatabaseColumns(
  fields: readonly FormField[],
  existing: readonly DatabaseColumn[]
): { columns: DatabaseColumn[]; added: DatabaseColumn[] } {
  const have = new Set(existing.map((column) => column.id));
  const added = fields.filter((field) => !have.has(field.id)).map(questionColumn);
  const viewerId = viewerColumnId(fields);
  if (!have.has(viewerId)) {
    added.push({ id: viewerId, label: "Viewer", type: "text", public: false });
  }
  return { columns: [...existing, ...added], added };
}

/** What a `database.insert` step writes for a form: each question's answer, and who sent it. */
export function formDatabaseValues(
  fields: readonly FormField[],
  columns: readonly DatabaseColumn[]
): Record<string, string> {
  const ids = new Set(columns.map((column) => column.id));
  const values: Record<string, string> = {};
  for (const field of fields) {
    if (ids.has(field.id)) {
      values[field.id] = formAnswerReference(field.id);
    }
  }
  const viewerId = viewerColumnId(fields);
  if (ids.has(viewerId)) {
    values[viewerId] = VIEWER_NAME_REFERENCE;
  }
  return values;
}

export interface FormDatabaseWorkflowOptions {
  triggerPreset: TriggerPreset;
  conditionFields: ConfigField[];
  order: number;
  /** The trigger's form field, held to the form. */
  form: TriggerPin;
  insert: ActionPreset;
  /** The action's database field, aimed at the database. */
  database: TriggerPin;
  values: Record<string, string>;
}

/**
 * An ordinary workflow, editable like any other: when this form is
 * submitted, add a row of its answers. The submission id is the row's key,
 * so a submission delivered twice adds one row.
 */
export function formDatabaseWorkflowTree(options: FormDatabaseWorkflowOptions): WorkflowTree {
  const { triggerPreset, conditionFields, order, form, insert, database, values } = options;
  const tree = newTriggerTree({ triggerPreset, conditionFields, order, pin: form, seed: insert, aim: database });
  return {
    ...tree,
    steps: tree.steps.map((step) =>
      step.type === "action"
        ? { ...step, parameters: { ...step.parameters, values, key: SUBMISSION_ID_REFERENCE } }
        : step
    ),
  };
}

/**
 * The workflow saving `formId`'s answers to `databaseId`, and its insert
 * step, so running the shortcut again updates that step instead of adding a
 * second workflow that would write every answer twice. Null when there is none.
 */
export function formDatabaseWorkflow(
  triggers: readonly EventTrigger[],
  formId: string,
  databaseId: string
): { trigger: EventTrigger; taskId: string } | null {
  for (const trigger of triggers) {
    if (
      !trigger.conditions.some((condition) => condition.field === FORM_CONDITION_FIELD && condition.value === formId)
    ) {
      continue;
    }
    const task = trigger.definition.tasks.find(
      (candidate) =>
        (candidate as { $ref?: unknown }).$ref === DATABASE_INSERT_ACTION_REF &&
        candidate.parameters?.target === databaseId
    );
    if (task) {
      return { trigger, taskId: task.id };
    }
  }
  return null;
}

/** `definition` with the insert step `taskId` writing `values`. */
export function withInsertValues(
  definition: WorkflowDefinition,
  taskId: string,
  values: Record<string, string>
): WorkflowDefinition {
  return {
    ...definition,
    tasks: definition.tasks.map((task) =>
      task.id === taskId ? { ...task, parameters: { ...task.parameters, values } } : task
    ),
  };
}
