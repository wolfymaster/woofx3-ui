import { describe, expect, test } from "bun:test";
import { escapeDollarKeys } from "@shared/dollar-keys";
import type { FormField } from "@shared/user-pages";
import type { Workflow } from "@/engine/types";
import { eventTriggers } from "@/lib/alert-triggers";
import {
  DATABASE_INSERT_ACTION_REF,
  FORM_SUBMITTED_EVENT,
  formAnswerReference,
  formDatabaseColumns,
  formDatabaseValues,
  formDatabaseWorkflow,
  formDatabaseWorkflowTree,
  withInsertValues,
} from "@/lib/form-kind";
import type { ActionPreset, ConfigField, TriggerPreset } from "@/lib/workflow-presets";
import { treeToDefinition } from "@/lib/workflow-tree";

const icon = (() => null) as unknown as ActionPreset["icon"];
const FORM = "woofx3:form:requests";
const DATABASE = "woofx3:database:requests";

const fields: FormField[] = [
  { id: "song", label: "Song", type: "text", required: true, maxLength: 200 },
  { id: "why", label: "Why", type: "textarea", required: false, maxLength: 2000 },
  {
    id: "mood",
    label: "Mood",
    type: "select",
    required: false,
    options: [
      { value: "chill", label: "Chill" },
      { value: "hype", label: "Hype" },
    ],
  },
  { id: "agree", label: "Agree", type: "checkbox", required: false },
];

describe("formDatabaseColumns", () => {
  test("gives each question a private column of its type, and one for the viewer", () => {
    const { columns } = formDatabaseColumns(fields, []);
    expect(columns).toEqual([
      { id: "song", label: "Song", type: "text", public: false },
      { id: "why", label: "Why", type: "text", public: false },
      {
        id: "mood",
        label: "Mood",
        type: "select",
        public: false,
        options: [
          { value: "chill", label: "Chill" },
          { value: "hype", label: "Hype" },
        ],
      },
      { id: "agree", label: "Agree", type: "boolean", public: false },
      { id: "viewer", label: "Viewer", type: "text", public: false },
    ]);
  });

  test("a choice whose values a column can't hold becomes text", () => {
    const odd: FormField = { ...fields[2], options: [{ value: "a b", label: "A b" }] } as FormField;
    expect(formDatabaseColumns([odd], []).columns[0]?.type).toBe("text");
  });

  test("run again, adds only questions the database lacks, leaving the rest as the streamer set them", () => {
    const first = formDatabaseColumns(fields.slice(0, 2), []).columns.map((column) =>
      column.id === "song" ? { ...column, label: "Song title", public: true } : column
    );
    const again = formDatabaseColumns(fields, first);
    expect(again.added.map((column) => column.id)).toEqual(["mood", "agree"]);
    expect(again.columns.find((column) => column.id === "song")).toEqual({
      id: "song",
      label: "Song title",
      type: "text",
      public: true,
    });
  });

  test("a question named viewer keeps its id, and the viewer column takes another", () => {
    const named: FormField = { id: "viewer", label: "Your name", type: "text", required: false, maxLength: 50 };
    const ids = formDatabaseColumns([named], []).columns.map((column) => column.id);
    expect(ids).toEqual(["viewer", "viewer_2"]);
  });
});

const formTrigger: TriggerPreset = {
  id: "t",
  canonicalRef: "woofx3:trigger:userpage_form_submitted",
  name: "Form submitted",
  description: "",
  icon,
  category: "Forms",
  color: "#888",
  event: FORM_SUBMITTED_EVENT,
} as TriggerPreset;

const insert: ActionPreset = {
  id: "a",
  canonicalRef: DATABASE_INSERT_ACTION_REF,
  name: "Add a row",
  description: "",
  icon,
  category: "Tools",
  color: "#888",
  handlerType: "native",
  config: {
    fields: [
      { id: "target", label: "Database", type: "resource_ref", resourceKind: "database" },
      {
        id: "values",
        label: "Values",
        type: "database_values",
        source: { kind: "databaseColumns", databaseField: "target" },
      },
      { id: "key", label: "Only once per", type: "text" },
    ] as ConfigField[],
  },
} as ActionPreset;

const formField = {
  id: "form",
  label: "Form",
  type: "resource_ref",
  resourceKind: "form",
  eventPath: "formId",
} as ConfigField;

describe("formDatabaseWorkflowTree", () => {
  test("adds a row of every answer, keyed by the submission so a redelivery adds nothing", () => {
    const { columns } = formDatabaseColumns(fields, []);
    const values = formDatabaseValues(fields, columns);
    const definition = treeToDefinition(
      formDatabaseWorkflowTree({
        triggerPreset: formTrigger,
        conditionFields: [formField],
        order: 0,
        form: { fieldId: "form", value: FORM },
        insert,
        database: { fieldId: "target", value: DATABASE },
        values,
      })
    );
    expect(definition.trigger.event).toBe(FORM_SUBMITTED_EVENT);
    const [task] = definition.tasks;
    expect(task?.parameters).toEqual({
      target: DATABASE,
      values: {
        song: formAnswerReference("song"),
        why: formAnswerReference("why"),
        mood: formAnswerReference("mood"),
        agree: formAnswerReference("agree"),
        viewer: ["$", "{trigger.data.viewer.displayName}"].join(""),
      },
      key: ["$", "{trigger.data.submissionId}"].join(""),
    });
  });
});

describe("formDatabaseWorkflow", () => {
  function row(trigger: Record<string, unknown>, tasks: unknown[]): Workflow {
    return {
      _id: "doc",
      _creationTime: 0,
      instanceId: "instance",
      engineWorkflowId: "wf-1",
      definition: escapeDollarKeys({ id: "wf-1", name: "wf", trigger, tasks }),
      isEnabled: true,
      createdAt: 0,
    } as unknown as Workflow;
  }
  const trigger = {
    type: "event",
    event: FORM_SUBMITTED_EVENT,
    conditions: [{ field: ["$", "{trigger.data.formId}"].join(""), operator: "eq", value: FORM }],
  };
  const task = {
    id: "step_1",
    type: "action",
    action: "database.insert",
    $ref: DATABASE_INSERT_ACTION_REF,
    parameters: { target: DATABASE, values: { song: "x" } },
  };

  test("finds the workflow saving this form to this database, so a re-run updates it", () => {
    const triggers = eventTriggers([row(trigger, [task])], FORM_SUBMITTED_EVENT);
    const found = formDatabaseWorkflow(triggers, FORM, DATABASE);
    expect(found?.taskId).toBe("step_1");
    expect(formDatabaseWorkflow(triggers, FORM, "woofx3:database:other")).toBeNull();
    expect(formDatabaseWorkflow(triggers, "woofx3:form:other", DATABASE)).toBeNull();
    if (found) {
      const updated = withInsertValues(found.trigger.definition, found.taskId, { song: "a", why: "b" });
      expect(updated.tasks[0]?.parameters).toEqual({ target: DATABASE, values: { song: "a", why: "b" } });
    }
  });
});
